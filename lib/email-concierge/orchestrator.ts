import { prisma } from "../db/client";
import { classifyIntent, ClassificationError } from "./classifier";
import { retrieveContext } from "./retrieval";
import { generateReply } from "./generator";
import { preGenerationCheck } from "./escalation";
import { storeInteraction } from "./memory";
import { findBookingId, findFailedBooking } from "./tools";
import {
  inboundEmailSchema,
  parseRestaurantConfig,
  type ConciergeResult,
  type ToolCallRecord,
} from "./types";

/**
 * Hela Email Concierge-pipelinen för ett inkommande mejl:
 * gäst-upsert → klassificering → eskaleringskoll → RAG → generering med
 * verktyg → utkast/eskalering sparas → interaktionen sammanfattas och embeddas.
 *
 * Skickar ALDRIG något — resultatet är ett DRAFT- eller ESCALATED-meddelande.
 */
export async function processInboundEmail(
  restaurantSlug: string,
  rawEmail: unknown,
): Promise<ConciergeResult> {
  const email = inboundEmailSchema.parse(rawEmail);
  const today = (email.receivedAt ?? new Date().toISOString()).slice(0, 10);

  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { slug: restaurantSlug },
  });
  const config = parseRestaurantConfig(restaurant.config);

  // Gäst + tråd + inkommande meddelande
  const guest = await prisma.guest.upsert({
    where: {
      restaurantId_email: { restaurantId: restaurant.id, email: email.from },
    },
    update: {},
    create: { restaurantId: restaurant.id, email: email.from },
  });
  const thread = await prisma.emailThread.create({
    data: {
      restaurantId: restaurant.id,
      guestId: guest.id,
      subject: email.subject,
    },
  });
  const inbound = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      direction: "INBOUND",
      status: "RECEIVED",
      fromAddress: email.from,
      body: email.body,
    },
  });

  // Klassificering — oparsebart svar är i sig ett eskaleringsskäl
  let intentResult;
  try {
    intentResult = await classifyIntent(email, today);
  } catch (e) {
    if (!(e instanceof ClassificationError)) throw e;
    intentResult = null;
  }

  if (intentResult) {
    await prisma.emailMessage.update({
      where: { id: inbound.id },
      data: { intent: intentResult.intent, confidence: intentResult.confidence },
    });
    if (intentResult.extracted.name && !guest.name) {
      await prisma.guest.update({
        where: { id: guest.id },
        data: { name: intentResult.extracted.name },
      });
    }
  }

  const intent = intentResult?.intent ?? "OTHER";
  const confidence = intentResult?.confidence ?? 0;
  let toolCalls: ToolCallRecord[] = [];
  let outcome: ConciergeResult["outcome"];
  let bookingId: string | undefined;

  const escalation = intentResult
    ? preGenerationCheck(intentResult, config)
    : ({ escalate: true, reason: "Klassificeringen misslyckades" } as const);

  if (escalation.escalate) {
    outcome = { kind: "escalated", reason: escalation.reason };
  } else {
    const context = await retrieveContext(restaurant.id, guest.id, email.body);
    const generated = await generateReply(
      { restaurantId: restaurant.id, config, guestId: guest.id },
      restaurant.name,
      email,
      context,
      today,
    );
    toolCalls = generated.toolCalls;
    bookingId = findBookingId(toolCalls);

    const bookingFailure = findFailedBooking(toolCalls);
    if (bookingFailure && !bookingId) {
      outcome = {
        kind: "escalated",
        reason: `Bokningen kunde inte genomföras: ${bookingFailure}`,
      };
    } else {
      outcome = { kind: "draft", reply: generated.draft };
    }
  }

  // Utgående meddelande: DRAFT väntar på granskning, ESCALATED väntar på människa
  await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      direction: "OUTBOUND",
      status: outcome.kind === "draft" ? "DRAFT" : "ESCALATED",
      fromAddress: `concierge@${restaurantSlug}.example`,
      body: outcome.kind === "draft" ? outcome.reply : "",
      intent,
      confidence,
      escalated: outcome.kind === "escalated",
      escalationReason: outcome.kind === "escalated" ? outcome.reason : null,
    },
  });

  // Guest Intelligence: sammanfatta + embedda för framtida RAG
  await storeInteraction(
    guest.id,
    email,
    outcome.kind === "draft" ? outcome.reply : `ESKALERAD: ${outcome.reason}`,
    intent,
  );

  return {
    restaurantSlug,
    guestId: guest.id,
    threadId: thread.id,
    intent,
    confidence,
    toolCalls,
    outcome,
    bookingId,
  };
}

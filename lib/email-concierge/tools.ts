import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { prisma } from "../db/client";
import { checkAvailability, createBooking } from "../booking/availability";
import type { RestaurantConfig, ToolCallRecord } from "./types";

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Kolla om det finns ett ledigt bord för ett datum, en tid och ett antal gäster.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["date", "time", "party_size"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM (24h)" },
          party_size: { type: "integer", minimum: 1 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Skapa en bokning (status PENDING). Anropa endast när datum, tid och antal gäster är bekräftade i mejlet.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["date", "time", "party_size"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM (24h)" },
          party_size: { type: "integer", minimum: 1 },
          notes: { type: "string", description: "Önskemål, allergier etc." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_guest_profile",
      description:
        "Hämta gästens profil: preferenser, allergier, favoritbord och besökshistorik.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
];

export type ToolContext = {
  restaurantId: string;
  config: RestaurantConfig;
  guestId: string;
};

/** Kör ett tool-anrop från modellen. Returnerar JSON-serialiserbart resultat. */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "check_availability":
      return checkAvailability(
        ctx.restaurantId,
        ctx.config,
        String(args.date),
        String(args.time),
        Number(args.party_size),
      );
    case "create_booking":
      return createBooking(
        ctx.restaurantId,
        ctx.config,
        ctx.guestId,
        String(args.date),
        String(args.time),
        Number(args.party_size),
        args.notes ? String(args.notes) : undefined,
      );
    case "get_guest_profile": {
      const profile = await prisma.guestProfile.findUnique({
        where: { guestId: ctx.guestId },
      });
      const recent = await prisma.guestInteraction.findMany({
        where: { guestId: ctx.guestId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, type: true, summary: true },
      });
      return { profile, recentInteractions: recent };
    }
    default:
      return { error: `Okänt verktyg: ${name}` };
  }
}

/** Plocka ut bookingId ur en lyckad create_booking i tool-loggen. */
export function findBookingId(records: ToolCallRecord[]): string | undefined {
  for (const record of records) {
    if (record.name !== "create_booking") continue;
    const result = record.result as { ok?: boolean; bookingId?: string };
    if (result?.ok && result.bookingId) return result.bookingId;
  }
  return undefined;
}

/** Hitta en misslyckad create_booking (→ eskalering). */
export function findFailedBooking(
  records: ToolCallRecord[],
): string | undefined {
  for (const record of records) {
    if (record.name !== "create_booking") continue;
    const result = record.result as { ok?: boolean; reason?: string };
    if (result && result.ok === false) return result.reason ?? "okänd orsak";
  }
  return undefined;
}

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { prisma } from "../lib/db/client";
import { processInboundEmail } from "../lib/email-concierge/orchestrator";

// Lokal testrunner: npm run concierge:test -- --file samples/booking-request.json [--slug demo]

const { values } = parseArgs({
  options: {
    file: { type: "string", short: "f" },
    slug: { type: "string", short: "s", default: "demo" },
  },
});

if (!values.file) {
  console.error(
    "Användning: npm run concierge:test -- --file samples/booking-request.json [--slug demo]",
  );
  process.exit(1);
}

async function main() {
  const email = JSON.parse(readFileSync(values.file!, "utf-8"));
  console.log(`📧 Bearbetar mejl från ${email.from} (restaurang: ${values.slug})\n`);

  const started = Date.now();
  const result = await processInboundEmail(values.slug!, email);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Intent: ${result.intent} (confidence ${result.confidence.toFixed(2)})`);
  for (const call of result.toolCalls) {
    console.log(`🔧 ${call.name}(${JSON.stringify(call.arguments)})`);
    console.log(`   → ${JSON.stringify(call.result)}`);
  }
  if (result.bookingId) console.log(`📅 Bokning skapad: ${result.bookingId}`);

  if (result.outcome.kind === "draft") {
    console.log(`\n✉️  UTKAST (väntar på granskning):\n---\n${result.outcome.reply}\n---`);
  } else {
    console.log(`\n🚩 ESKALERAD: ${result.outcome.reason}`);
  }
  console.log(`\nKlart på ${elapsed}s · tråd ${result.threadId}`);
}

main()
  .catch((e) => {
    console.error("Concierge-körningen misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

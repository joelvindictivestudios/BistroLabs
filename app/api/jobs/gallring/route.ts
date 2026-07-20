import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { releaseCard } from "@/lib/payments/psp";

// GET /api/jobs/gallring — daglig cron (03:30, se vercel.json). Säkerhetsnät
// för GDPR-gallringen av allergiuppgifter: primärt nollas allergyNote inline
// när bokningen sätts till COMPLETED, men bokningar som aldrig statusflippas
// (glömda, avbokade, no-shows eller passerade) fångas här. Samtyckesloggen
// (allergyConsentAt/Text) behålls som bevis på att uppgiften hanterats rätt.
//
// Kortreferenser gallras enligt reglerna i planen (spec §4 "beslutas
// separat" — förankrad default):
// - Gästavbokning: släpps DIREKT i avboka-routen (§3.6)
// - COMPLETED: släpps inline i staff-PATCH
// - Personalavbokad: behålls 7 dagar (återaktiveringsfönster, §3.5) → städas här
// - NO_SHOW: behålls tills avgiften debiterats eller 30 dagar passerat
export async function GET(request: NextRequest) {
  if (
    request.headers.get("authorization") !==
    `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Obehörig." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
  const wiped = await prisma.booking.updateMany({
    where: {
      allergyNote: { not: null },
      OR: [
        { status: { in: ["COMPLETED", "CANCELLED", "NO_SHOW"] } },
        { endsAt: { lt: cutoff } },
      ],
    },
    data: { allergyNote: null },
  });

  const noShowCutoff = new Date(Date.now() - 30 * 24 * 3600_000);
  const cardRows = await prisma.booking.findMany({
    where: {
      cardPspToken: { not: null },
      OR: [
        { status: "COMPLETED" },
        { status: "CANCELLED", endsAt: { lt: cutoff } },
        {
          status: "NO_SHOW",
          OR: [{ charged: { not: null } }, { endsAt: { lt: noShowCutoff } }],
        },
      ],
    },
    select: { id: true, cardPspToken: true },
    take: 500,
  });
  for (const row of cardRows) {
    if (row.cardPspToken) await releaseCard(row.cardPspToken); // best-effort
  }
  if (cardRows.length > 0) {
    await prisma.booking.updateMany({
      where: { id: { in: cardRows.map((r) => r.id) } },
      data: { cardPspToken: null, cardLast4: null },
    });
  }

  return NextResponse.json({
    wiped: wiped.count,
    cardsReleased: cardRows.length,
  });
}

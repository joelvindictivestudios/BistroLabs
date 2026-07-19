import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";

// GET /api/jobs/gallring — daglig cron (03:30, se vercel.json). Säkerhetsnät
// för GDPR-gallringen av allergiuppgifter: primärt nollas allergyNote inline
// när bokningen sätts till COMPLETED, men bokningar som aldrig statusflippas
// (glömda, avbokade, no-shows eller passerade) fångas här. Samtyckesloggen
// (allergyConsentAt/Text) behålls som bevis på att uppgiften hanterats rätt.
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

  return NextResponse.json({ wiped: wiped.count });
}

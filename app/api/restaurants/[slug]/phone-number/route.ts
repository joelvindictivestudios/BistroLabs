import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { getCoreFactsStatus } from "@/lib/restaurant/core-facts";
import { searchAvailableNumbers, purchaseNumber } from "@/lib/twilio";

// POST /api/restaurants/{slug}/phone-number — köper ett riktigt Twilio-nummer
// och pekar det mot väntsvaret. Gated: grundinfo (Träna din AI) måste vara klar.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/phone-number">,
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Inte inloggad." }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    return NextResponse.json({ error: "Okänd restaurang." }, { status: 404 });
  }
  if (restaurant.ownerId !== user.id) {
    return NextResponse.json(
      { error: "Du äger inte den här restaurangen." },
      { status: 403 },
    );
  }

  const config = parseRestaurantConfig(restaurant.config);
  if (config.voiceAgent.phoneNumber) {
    return NextResponse.json(
      { error: `Restaurangen har redan numret ${config.voiceAgent.phoneNumber}.` },
      { status: 409 },
    );
  }

  const facts = await getCoreFactsStatus(restaurant.id, config);
  if (!facts.complete) {
    const missing = [
      !facts.hasAddress && "adress",
      !facts.hasOpeningHours && "öppettider",
      facts.documentCount === 0 && "minst ett kunskapsdokument",
    ]
      .filter(Boolean)
      .join(", ");
    return NextResponse.json(
      { error: `Fyll i grundinfo under "Träna din AI" först — saknas: ${missing}.` },
      { status: 409 },
    );
  }

  // VoiceUrl måste vara publikt nåbar — Twilio kan inte ringa localhost
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  if (/localhost|127\.0\.0\.1/.test(origin)) {
    return NextResponse.json(
      {
        error:
          "Telefonnummer kan bara genereras från den publika miljön (Twilio kan inte nå localhost). Deploya först, eller sätt NEXT_PUBLIC_APP_URL.",
      },
      { status: 409 },
    );
  }
  const voiceUrl = `${origin}/api/voice/incoming?slug=${encodeURIComponent(slug)}`;

  try {
    // TWILIO_NUMBER_COUNTRY låter oss testa köpflödet med t.ex. US innan
    // den svenska regulatoriska bundlen är på plats i Twilio-konsolen
    const country = process.env.TWILIO_NUMBER_COUNTRY ?? "SE";
    const candidates = await searchAvailableNumbers(country, 3);
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error:
            country === "SE"
              ? "Inga röstkapabla svenska nummer är tillgängliga på Twilio-kontot ännu. Svenska nummer kräver en regulatorisk bundle (identitet + adress) som registreras i Twilio-konsolen under Phone Numbers → Regulatory Compliance."
              : `Inga lediga nummer hittades för ${country} just nu.`,
        },
        { status: 502 },
      );
    }
    const purchased = await purchaseNumber(candidates[0].phoneNumber, voiceUrl);

    config.voiceAgent = {
      ...config.voiceAgent,
      phoneNumber: purchased.phoneNumber,
      phoneSid: purchased.sid,
    };
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { config },
    });

    return NextResponse.json(
      { phoneNumber: purchased.phoneNumber },
      { status: 201 },
    );
  } catch (e) {
    // T.ex. saknad regulatorisk bundle för SE-nummer — visa Twilios besked rakt av
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Nummerköpet misslyckades." },
      { status: 502 },
    );
  }
}

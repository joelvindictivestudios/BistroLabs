import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";

// Twilio anropar denna vid inkommande samtal (ingen auth — publik webhook).
// Placeholder-TwiML tills gpt-realtime-bridgen byggs: hälsning + ev.
// vidarekoppling till personalens nummer.

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const restaurant = slug
    ? await prisma.restaurant.findUnique({ where: { slug } })
    : null;

  const name = restaurant?.name ?? "restaurangen";
  const config = restaurant ? parseRestaurantConfig(restaurant.config) : null;
  const transferNumber = config?.voiceAgent.transferNumber ?? "";

  const lines = [
    `<Say language="sv-SE">Hej och välkommen till ${escapeXml(name)}. Vår A I-assistent lanseras inom kort.</Say>`,
  ];
  if (transferNumber) {
    lines.push(
      `<Say language="sv-SE">Jag kopplar dig till personalen.</Say>`,
      `<Dial>${escapeXml(transferNumber)}</Dial>`,
    );
  } else {
    lines.push(
      `<Say language="sv-SE">Besök vår bokningssida på webben för att boka bord. Tack för ditt samtal!</Say>`,
    );
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${lines.join("")}</Response>`;
  return new Response(twiml, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

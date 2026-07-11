import { prisma } from "../lib/db/client";
import { embedMany } from "../lib/ai/embeddings";
import {
  setKnowledgeEmbedding,
  setInteractionEmbedding,
} from "../lib/db/vector";
import type { RestaurantConfig } from "../lib/email-concierge/types";

const DEMO_SLUG = "demo";

const demoConfig: RestaurantConfig = {
  timezone: "Europe/Stockholm",
  openingHours: {
    tue: [{ open: "17:00", close: "23:00" }],
    wed: [{ open: "17:00", close: "23:00" }],
    thu: [{ open: "17:00", close: "23:00" }],
    fri: [{ open: "17:00", close: "23:00" }],
    sat: [{ open: "17:00", close: "23:00" }],
  },
  bookingDurationMinutes: 120,
  escalationPartySize: 8,
  confidenceThreshold: 0.7,
  tone: {
    styleGuide:
      "Varm, personlig och professionell. Svara på svenska. Kortfattat men aldrig snorkigt. " +
      "Bekräfta alltid datum, tid och antal gäster explicit. Avsluta med 'Varma hälsningar, Demo Bistro'.",
    fewShotExamples: [
      {
        guest: "Hej! Har ni plats för 2 på fredag kväll?",
        reply:
          "Hej! Vad roligt att ni vill besöka oss. Fredag kväll har vi plats för 2 personer — " +
          "passar kl 19:00? Säg bara till så reserverar jag bordet.\n\nVarma hälsningar, Demo Bistro",
      },
      {
        guest: "Kan man sitta ute hos er?",
        reply:
          "Hej! Under sommarmånaderna har vi en mysig uteservering på innergården med plats för " +
          "ca 20 gäster. Den går inte att förboka, men kom gärna tidigt så brukar det ordna sig.\n\n" +
          "Varma hälsningar, Demo Bistro",
      },
    ],
  },
  menu:
    "Säsongsbetonad nordisk bistromeny. Signaturrätter: smörstekt torskrygg med brynt smör, " +
    "lammracks med rostad jordärtskocka, svamprisotto (vegetarisk). Avsmakningsmeny 5 rätter 745 kr. " +
    "Vegetariska och veganska alternativ finns alltid.",
  offerings: [
    {
      id: "middag",
      title: "Middag",
      description: "Vår klassiska kvällssittning i matsalen.",
      imageUrl: "",
    },
    {
      id: "avsmakningsmeny",
      title: "Avsmakningsmeny",
      description: "Fem rätter ur säsongens skafferi, 745 kr per person.",
      imageUrl: "",
    },
    {
      id: "uteserveringen",
      title: "Uteserveringen",
      description: "Innergården under sommarmånaderna — väderberoende.",
      imageUrl: "",
    },
  ],
  heroImageUrl: "",
  logoUrl: "",
  address: "Storgatan 1, 111 22 Stockholm",
  closedDates: [],
  bookingStopDates: [],
  sameDayCutoff: "14:00",
  voiceAgent: {
    voice: "coral",
    greeting: "",
    maxWaitSeconds: 20,
    transferNumber: "",
    phoneNumber: "",
    phoneSid: "",
  },
};

const knowledgeDocs = [
  {
    category: "policy",
    title: "Avbokningspolicy",
    content:
      "Avbokning är kostnadsfri fram till 24 timmar före bokad tid. Vid senare avbokning eller " +
      "utebliven ankomst debiteras 250 kr per person för sällskap om 6 eller fler.",
  },
  {
    category: "policy",
    title: "Husdjur",
    content:
      "Hundar är välkomna på vår uteservering men tillåts inte i matsalen, med undantag för " +
      "ledarhundar och assistanshundar som alltid är välkomna.",
  },
  {
    category: "policy",
    title: "Stora sällskap",
    content:
      "För sällskap över 8 personer hanterar vi bokningar manuellt via mejl. Vi erbjuder då en " +
      "förbeställd gruppmeny. Kontakta oss minst en vecka i förväg för bästa möjlighet till plats.",
  },
  {
    category: "faq",
    title: "Parkering",
    content:
      "Närmaste parkering är parkeringshuset på Storgatan 12, två minuters promenad från restaurangen. " +
      "Gatuparkering finns även på Lillgatan efter kl 18:00.",
  },
  {
    category: "faq",
    title: "Allergier och specialkost",
    content:
      "Vi hanterar alla vanliga allergier och specialkoster — meddela oss vid bokning så förbereder " +
      "köket. Glutenfria, laktosfria, vegetariska och veganska alternativ finns alltid på menyn.",
  },
  {
    category: "faq",
    title: "Klädkod",
    content:
      "Vi har ingen formell klädkod — kom som du är. De flesta gäster klär sig smart casual.",
  },
];

async function main() {
  console.log(`Seedar demo-restaurang (slug: ${DEMO_SLUG})...`);

  // Idempotent: rensa och bygg om demo-restaurangen från grunden
  await prisma.restaurant.deleteMany({ where: { slug: DEMO_SLUG } });

  const restaurant = await prisma.restaurant.create({
    data: {
      slug: DEMO_SLUG,
      name: "Demo Bistro",
      config: demoConfig,
    },
  });
  const matsalen = await prisma.room.create({
    data: { restaurantId: restaurant.id, name: "Matsalen", sortOrder: 0 },
  });
  const uteserveringen = await prisma.room.create({
    data: { restaurantId: restaurant.id, name: "Uteserveringen", sortOrder: 1 },
  });
  await prisma.diningTable.createMany({
    data: [
      // Matsalen — T1 är "endast 2" (minSeats = capacity) som exempel
      { name: "T1", capacity: 2, minSeats: 2, shape: "round", posX: 0, posY: 0 },
      { name: "T2", capacity: 2, minSeats: 1, shape: "round", posX: 3, posY: 0 },
      { name: "T3", capacity: 2, minSeats: 1, shape: "square", posX: 6, posY: 0 },
      { name: "T4", capacity: 4, minSeats: 2, shape: "round", posX: 0, posY: 3 },
      { name: "T5", capacity: 4, minSeats: 2, shape: "round", posX: 3, posY: 3 },
      { name: "T6", capacity: 6, minSeats: 4, shape: "rect", posX: 6, posY: 3 },
    ].map((t) => ({ ...t, restaurantId: restaurant.id, roomId: matsalen.id })),
  });
  await prisma.diningTable.createMany({
    data: [
      { name: "U1", capacity: 2, minSeats: 1, shape: "round", posX: 0, posY: 0 },
      { name: "U2", capacity: 4, minSeats: 2, shape: "square", posX: 3, posY: 0 },
    ].map((t) => ({
      ...t,
      restaurantId: restaurant.id,
      roomId: uteserveringen.id,
    })),
  });
  console.log(
    `Restaurang skapad (${restaurant.id}) med 2 rum och 8 bord`,
  );

  // Kunskapsdokument + embeddings i batch
  const embeddings = await embedMany(
    knowledgeDocs.map((d) => `${d.title}\n${d.content}`),
  );
  for (let i = 0; i < knowledgeDocs.length; i++) {
    const doc = await prisma.knowledgeDocument.create({
      data: { ...knowledgeDocs[i], restaurantId: restaurant.id },
    });
    await setKnowledgeEmbedding(doc.id, embeddings[i]);
  }
  console.log(`${knowledgeDocs.length} kunskapsdokument embeddade`);

  // Återkommande gäst med profil + en tidigare interaktion (för RAG-demo)
  const pastSummary =
    "Gästen bokade bord för 2 till fredagen, bad om vegetariska alternativ och nämnde " +
    "att det var deras bröllopsdag. Fick bord T5 vid fönstret och var mycket nöjd.";
  const guest = await prisma.guest.create({
    data: {
      restaurantId: restaurant.id,
      email: "anna.andersson@example.com",
      phone: "+46701234567",
      name: "Anna Andersson",
      profile: {
        create: {
          preferences: { seating: "fönsterbord", occasionNotes: "bröllopsdag i juli" },
          dietaryRestrictions: ["vegetarian"],
          favoriteTable: "T5",
          visitCount: 3,
          lastVisit: new Date("2026-06-12T19:00:00Z"),
        },
      },
      interactions: {
        create: {
          type: "EMAIL",
          intent: "BOOKING_REQUEST",
          rawContent:
            "Hej! Vi skulle vilja boka bord för 2 nu på fredag runt kl 19. Gärna vegetariskt " +
            "tips också — det är vår bröllopsdag! /Anna",
          summary: pastSummary,
        },
      },
    },
    include: { interactions: true },
  });
  const [interactionEmbedding] = await embedMany([pastSummary]);
  await setInteractionEmbedding(guest.interactions[0].id, interactionEmbedding);
  console.log(`Gäst "${guest.name}" med profil + embeddad interaktion skapad`);

  console.log("Seed klar ✓");
}

main()
  .catch((e) => {
    console.error("Seed misslyckades:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

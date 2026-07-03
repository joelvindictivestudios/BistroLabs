# BistroLabs

AI-driven plattform för restaurangdrift: gästkontakt via mejl (och telefon i v2), gästprofiler som byggs över tid, och bordsplanering. Byggd med Next.js 16, Prisma 7 och Supabase Postgres + pgvector.

## Kom igång

```bash
cp .env.example .env   # fyll i Supabase-anslutningar + OpenAI-nyckel
npm install
npx prisma migrate dev # skapar schema, pgvector-extension och HNSW-index
npm run db:seed        # demo-restaurang "demo" med bord, kunskapsbas och en gäst
```

## Testa Email Concierge lokalt

```bash
npm run concierge:test -- --file samples/booking-request.json
npm run concierge:test -- --file samples/faq-question.json
npm run concierge:test -- --file samples/large-party.json   # → eskaleras (>8 pers)
npm run concierge:test -- --file samples/complaint.json     # → eskaleras (klagomål)
```

Pipelinen: intent-klassificering → RAG (pgvector) → svarsgenerering i restaurangens ton → function calling (`check_availability`/`create_booking`/`get_guest_profile`) → utkast (`DRAFT`) eller eskalering (`ESCALATED`). Ingenting skickas automatiskt.

## Struktur

| Katalog | Innehåll |
|---|---|
| `prisma/` | Schema (källa till sanning) + migrationer |
| `lib/db/` | Prisma-klient (adapter-pg) + raw-SQL-vektorsökning |
| `lib/ai/` | OpenAI-klient + embeddings; modell-id:n styrs via env |
| `lib/booking/` | Availability-motor (greedy bordsallokering, ej LLM) |
| `lib/email-concierge/` | Hela concierge-pipelinen |
| `scripts/` | `seed.ts`, `concierge-test.ts` |
| `samples/` | Testmejl i JSON-format |

Se `.claude/BistroLabs/Planning/2.v1Exec.md` för exekverad v1-scope och vägen mot v2 (Voice Agent m.m.).

## Övriga kommandon

```bash
npm run dev          # Next.js dev-server (frontend är fortfarande scaffold)
npm run db:studio    # Prisma Studio — bläddra i databasen
npm run db:migrate   # ny migration efter schemaändring
npm run lint         # eslint (OBS: next lint är borttaget i Next 16)
```

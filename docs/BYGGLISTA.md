# BYGGLISTA — GPG Booking

**Datum:** 20 juli 2026 · **Baserad på:** `OVERLAMNING-GPG.md` (v2) + `STATUS-MOT-REPO.md` (jämfört mot `main` @ `313e0ed`)
**Så används listan:** Det här är arbetslistan — bocka av `[ ]` → `[x]` direkt i filen. Lägg gärna filen i repot (t.ex. `docs/BYGGLISTA.md`) så följer status med koden och kan uppdateras i samma PR som ändringen. Etapperna är i beroendeordning — börja uppifrån.

Referenser i parentes pekar på avsnitt i `OVERLAMNING-GPG.md`. Det som redan finns i repot är INTE med här — se del A i `STATUS-MOT-REPO.md` innan du bygger något som känns bekant.

---

## Etapp 1 — Schema + konfiguration
*Beroende: ingen. Allt annat bygger på den här.*

- [x] Migration `Booking`: `cardPspToken` (text, null), `cardLast4` (text, null) — ALDRIG kortnummer (PCI DSS, §1), `charged` (decimal, null), `cancelInfo` (JSON: `{ av: "personal" | "gäst" | "auto", orsak?, tidpunkt }`)
- [x] Migration: ny modell `WaitlistEntry` — restaurantId, namn, mobil, antal, datum, önskat tidsintervall, status `väntar | erbjuden` (§1)
- [x] Migration: ny modell `CommunicationLog` — bookingId, typ (mottagen / kortlänk / bekräftelse / påminnelse / auto-avbokning / avgift-debiterad / avbokningsbekräftelse / ändring), kanal (mejl / sms), tidpunkt (§1)
- [x] `RestaurantConfig` (zod i `lib/email-concierge/types.ts`): `noShowFeePerGuest` (default 250), `cancellationWindowHours` (default 4), `cardGuaranteeRequired` (default true) (§2b)
- [x] Settings: nytt block **No-show-skydd** i `settings-client.tsx` + spara via befintlig restaurang-PUT — samma mönster som Bokningsregler-blocket (§2 p.7, §2b p.5)

**Klart när:** migrationerna är körda, config validerar, och personalen kan ändra alla tre värdena per restaurang i UI:t.

## Etapp 2 — Signerad hanteringslänk + "Hantera bokning"
*Beroende: etapp 1. Byggs tidigt eftersom alla mejlmallar och hela självservicen pekar hit.*

- [x] Tokenmodul: HMAC över bookingId + utgångstid, secret i env — ingen inloggning krävs (§2 p.5)
- [x] Publik sida `/hantera/[token]` (§3.6): visa bokningen, omboka datum/tid (stängda dagar + fulla tider bortfiltrerade — återanvänd widgetens slots-endpoint), ändra antal, allergier (återanvänd samtyckesmodulen i `lib/booking/consent.ts`), meddelande till restaurangen
- [x] Spara → grön kvittens "restaurangen har meddelats" + rad i `CommunicationLog`
- [x] Avboka kostnadsfritt när mer än `cancellationWindowHours` återstår; skriv `cancelInfo` (gäst själv), släpp kortgarantin (PSP-stub tills etapp 3)
- [x] Inom fönstret: stäng ändring/avbokning via länken och visa restaurangens telefonnummer istället (§3.6 sista stycket — POC:n visar den generösa vägen, produktionen ska spärra)

**Klart när:** en gäst kan via länken omboka, ändra antal, ange allergi och avboka, spärren inom fönstret fungerar, och allt loggas.

## Etapp 3 — Preliminärflödet
*Beroende: etapp 1 + 2.*

- [x] "Ny bokning": statusval **Preliminär** (default) / **Bekräftad** + e-postfält; infotext vid Bekräftad att ingen no-show-avgift kan debiteras utan kort (§3.2)
- [x] PENDING-semantiken utökas till "väntar på kortbekräftelse" — badge-label ändras från "Väntar" till "Preliminär"; AI-mejlflödets användning och Bekräfta-knappen behålls (§3.3)
- [x] Utskicksmall 2 **Kortlänk**: förklarar garantin, inget dras nu, auto-avbokning utan kort; CTA "Ange kort och bekräfta" (§3.7)
- [x] Kortsida via hanteringslänken: kortnummer (minst 12 siffror aktiverar knappen), giltighet, CVC mot PSP-stubben; spara `cardLast4`; auto-bekräfta → `CONFIRMED` + bekräftelsemejl (§2 p.2, §3.1 kortsteget)
- [x] Gul panel i bokningsdetaljen: "Väntar på kortbekräftelse" + beräknad deadline ("avbokas automatiskt kl HH:MM — X tim före") + knappen **"Skicka kortlänken igen"** (§3.3). Deadline beräknas vid rendering, lagras aldrig (§2b p.3)

**Klart när:** personal skapar preliminär → gästen får kortlänken → anger kort → bokningen auto-bekräftas, med varje steg i kommunikationsloggen.

## Etapp 4 — Auto-avbokningsjobbet
*Beroende: etapp 1 + 3.*

- [x] Ny cron i `vercel.json` (förslagsvis var 15:e minut): `PENDING` utan kort där starttid − `cancellationWindowHours` passerats → `CANCELLED`, `cancelInfo` = auto (§2 p.4)
- [x] Utskick till gästen om auto-avbokningen (mejl nu, SMS kopplas i etapp 7) + `CommunicationLog`
- [x] Idempotent + skyddad med `CRON_SECRET`, samma mönster som reminders/gallring

**Klart när:** en kortlös preliminär bokning avbokas automatiskt vid deadline, gästen meddelas och bordet frigörs.

## Etapp 5 — No-show med debitering
*Beroende: etapp 1 (kortdata från etapp 3 för skarpa fall).*

- [x] Dialog **med kort** (§3.4): specifikation (last4, `noShowFeePerGuest` × antal, totalbelopp), primärknapp "Debitera X kr och markera", sekundär "Markera no-show utan avgift"
- [x] Dialog **utan kort**: förklarande text, enda åtgärd är markera utan avgift — gäller även restauranger med `cardGuaranteeRequired: false` (§2b p.4)
- [x] Debitering mot PSP-stubben → skriv `charged`, röd panel "No-show-avgift debiterad" på bokningen
- [x] Beloppet in i gästens händelsehistorik och i `CommunicationLog` (underlag för rapporterna i etapp 10)

**Klart när:** no-show på en bokning med kort debiterar (stub) och loggar beloppet, utan kort går bara utan avgift.

## Etapp 6 — Utskicken kompletta
*Beroende: etapp 2.*

- [x] Alla tre mallar får hanteringslänk + policyfoten "fri avbokning/ändring till X tim före; Y kr/gäst vid no-show" — värden från config, inte hårdkodade (§3.7)
- [x] Gästnotis vid personalens **avbokning** och **ändring** — går inte ut tyst längre (§2 p.6, §3.5, §3.10)
- [x] Påminnelsejobbet utökas: även `PENDING` (kortpåminnelse-variant enligt §2 p.4) och hanteringslänk i båda varianterna
- [x] **"Visa utskick"**-flik i bokningsdetaljen: förhandsvisning av mallarna med bokningens data (§3.7)
- [x] Tidslinjen **"Kommunikation"** i bokningsdetaljen, driven av `CommunicationLog` (§1)

**Klart när:** varje gästpåverkande händelse syns i tidslinjen och alla mallar har länk + policyfot.

## Etapp 7 — SMS
*Beroende: etapp 6.*

- [x] `sendSms` i `lib/messaging/` via Twilio Messages API — dev-stub utan nycklar, samma mönster som `sendEmail` (§4 sista punkten)
- [x] Koppla SMS + mejl på alla gästpåverkande ändringar: bekräftad, ändrad, avbokad (inkl. auto), erbjuden tid från väntelistan (§2 p.6)
- [x] Avsändarnummer per restaurang — nuvarande +46767299044 är SMS-only och funkar för detta

**Klart när:** statusändringar går ut i båda kanalerna när kontaktväg finns.

## Etapp 8 — Väntelistan
*Beroende: etapp 1 + 7.*

- [x] Gäst: vid fullbokad önsketid i widgeten — "Ställ mig på väntelistan" → namn + mobil → status väntar (§3.8)
- [x] Personal: väntelistekortet överst i Bokningar, "Erbjud bord" → status erbjuden + SMS (§3.8)
- [x] Auto-match vid avbokning: om någon i kön passar (antal + tid) föreslås "Avboka och erbjud tiden till X" som primäråtgärd i avbokningsdialogen (§3.5)

**Klart när:** hela kedjan fullbokat → kö → avbokning → erbjudande → SMS fungerar.

## Etapp 9 — Widgetens kortsteg + återstående personalfunktioner
*Beroende: etapp 3 + 5.*

- [ ] Kortsteg i widgeten (steget mellan uppgifter och bekräftat) bakom `cardGuaranteeRequired`: kortfält mot PSP-stubben, infotext "inget dras nu" + policy; bekräftelsesidan får kortgaranti-raden + hanteringslänken (§3.1)
- [ ] Uppgiftssteget: logga in / skapa konto / fortsätt som gäst (§3.1) — gästkonton är en större bit; "fortsätt som gäst" är bärande flödet, kontodelen kan tas som egen punkt om den drar
- [ ] Återaktivera avbokade bokningar: → `CONFIRMED` om kort finns, annars `PENDING`; avbokade visas nedtonade med grå badge (§3.5)
- [ ] Ändra bokning: `partySize`, namn och telefon in i PATCH + detaljmodalen — gästnotisen kommer via etapp 6 (§3.10)
- [ ] Specialdagstyperna **Event** och **Deposition** i kalendern — endast listning, depositionsflödet är utanför scope (§3.11, §4)

**Klart när:** gästflödet kräver kort där det är påslaget, och personal kan återaktivera samt ändra alla bokningsfält.

## Etapp 10 — Rapporter + gästprofilen
*Beroende: etapp 5 (behöver debiteringsdata att räkna på).*

- [ ] Gästprofil: no-show-räknare, märkningar (allergi / stamgäst / barnfamilj), händelsehistorik (besök, avbokningar i tid, no-shows med belopp, ändringar) (§3.12)
- [ ] Rapporter (§3.13): no-show-andel 30 dgr (före/efter kortgarantin), debiterade avgifter, avbokningar varav auto, snittbeläggning; grafer no-shows per vecka (markera införandet) + beläggning per veckodag

**Klart när:** KPI:erna räknas på riktig data och gästprofilen visar hela historiken.

---

*Utanför scope (§4): skarp PSP-koppling (Stripe/Adyen — allt ovan byggs mot stub), retry vid misslyckad debitering, depositionsflödet, roller/behörighet, flerspråkigt gästflöde, DMARC.*

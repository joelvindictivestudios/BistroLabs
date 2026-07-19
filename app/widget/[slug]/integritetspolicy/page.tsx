import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";

export const metadata = { title: "Integritetspolicy" };

// Informationsplikten (GDPR art 13): vad som lagras, hur länge och vilka
// rättigheter gästen har. Länkas från widgetens bokningsformulär.
export default async function PrivacyPolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({ where: { slug } });
  if (!restaurant || !restaurant.published) notFound();
  const config = parseRestaurantConfig(restaurant.config);

  return (
    <div
      data-theme={config.widgetTheme === "warm-light" ? "light" : "widget-classic"}
      className="min-h-dvh bg-shell px-6 py-12 text-[var(--w-ink)]"
      // Widgetvärlden behåller sin serif (Fraunces) även i ljust tema
      style={
        {
          "--font-display": "var(--font-fraunces), Georgia, serif",
        } as React.CSSProperties
      }
    >
      <article className="mx-auto max-w-2xl">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
          {restaurant.name}
        </p>
        <h1 className="mt-1 text-3xl [font-family:var(--font-display),serif]">
          Integritetspolicy
        </h1>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-[var(--w-muted)]">
          <section>
            <h2 className="mb-2 text-base font-semibold text-[var(--w-ink)]">
              Vilka uppgifter vi behandlar
            </h2>
            <p>
              När du bokar bord sparar vi namn, kontaktuppgift (e-post eller
              telefon), sällskapets storlek och eventuella önskemål. Uppgifterna
              används för att hantera din bokning — bekräftelse, påminnelse och
              mottagande — och raderas eller anonymiseras när de inte längre
              behövs.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold text-[var(--w-ink)]">
              Allergiuppgifter
            </h2>
            <p>
              Uppgifter om allergier behandlas endast med ditt uttryckliga
              samtycke och används enbart för att förbereda ditt besök. De
              raderas automatiskt efter genomfört besök.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold text-[var(--w-ink)]">
              Utskick
            </h2>
            <p>
              Bokningsbekräftelse och påminnelse skickas som en del av
              bokningen. Marknadsföring skickas endast om du aktivt har
              samtyckt till det, och du kan när som helst återkalla samtycket.
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold text-[var(--w-ink)]">
              Dina rättigheter
            </h2>
            <p>
              Du har rätt att få veta vilka uppgifter vi har om dig, få dem
              rättade eller raderade, och invända mot behandlingen. Kontakta
              restaurangen så hjälper vi dig — radering sker utan onödigt
              dröjsmål. Du kan även lämna klagomål till
              Integritetsskyddsmyndigheten (imy.se).
            </p>
          </section>
        </div>
      </article>
    </div>
  );
}

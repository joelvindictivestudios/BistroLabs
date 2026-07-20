import { prisma } from "@/lib/db/client";
import { parseRestaurantConfig } from "@/lib/email-concierge/types";
import { verifyManageToken } from "@/lib/booking/manage-token";
import {
  cancellationDeadline,
  formatDeadlineTime,
  insideCancellationWindow,
} from "@/lib/booking/policy";
import { HanteraClient } from "./hantera-client";

export const metadata = { title: "Hantera bokning" };

// Gästens självservice (§3.6) — publik sida utan inloggning, nås via den
// signerade länken i utskicken. Token verifieras direkt här (RSC + Prisma);
// ändringar/avbokning går via /api/hantera/[token]/*.

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function Shell({
  theme,
  children,
}: {
  theme: "light" | "widget-classic";
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme={theme}
      className="min-h-dvh bg-shell px-6 py-12 text-[var(--w-ink)]"
      style={
        {
          "--font-display": "var(--font-fraunces), Georgia, serif",
        } as React.CSSProperties
      }
    >
      <article className="mx-auto max-w-lg">{children}</article>
    </div>
  );
}

function ErrorView({ title, body }: { title: string; body: string }) {
  return (
    <Shell theme="widget-classic">
      <h1 className="text-3xl [font-family:var(--font-display),serif]">
        {title}
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--w-muted)]">
        {body}
      </p>
    </Shell>
  );
}

export default async function HanteraPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verified = verifyManageToken(token);
  if (!verified.ok) {
    return (
      <ErrorView
        title="Länken fungerar inte längre"
        body={
          verified.reason === "utgangen"
            ? "Länken har gått ut. Kontakta restaurangen så hjälper vi dig."
            : "Länken är ogiltig eller trasig. Kontakta restaurangen så hjälper vi dig."
        }
      />
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: verified.bookingId },
    include: { guest: true, restaurant: true, table: true },
  });
  if (!booking) {
    return (
      <ErrorView
        title="Bokningen finns inte längre"
        body="Bokningen har tagits bort. Kontakta restaurangen om något inte stämmer."
      />
    );
  }

  const config = parseRestaurantConfig(booking.restaurant.config);
  const theme = config.widgetTheme === "warm-light" ? "light" : "widget-classic";

  const fmtDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
  });
  const fmtTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const fmtLabel = new Intl.DateTimeFormat("sv-SE", {
    timeZone: config.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // Datumvalet: bokningens egen dag + de kommande ~14 öppna dagarna
  const openDays: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  const bookingDate = fmtDate.format(booking.startsAt);
  const pushDay = (d: Date) => {
    const value = fmtDate.format(d);
    if (seen.has(value) || config.closedDates.includes(value)) return;
    const weekday = WEEKDAY_KEYS[new Date(`${value}T12:00:00Z`).getUTCDay()];
    if ((config.openingHours[weekday] ?? []).length === 0) return;
    seen.add(value);
    openDays.push({ value, label: fmtLabel.format(d) });
  };
  pushDay(booking.startsAt);
  for (let offset = 0; offset < 21 && openDays.length < 15; offset++) {
    pushDay(new Date(Date.now() + offset * 864e5));
  }

  const status =
    booking.status === "PENDING" || booking.status === "CONFIRMED"
      ? booking.status
      : booking.status === "CANCELLED"
        ? "CANCELLED"
        : "DONE";

  const deadline = cancellationDeadline(booking.startsAt, config);

  return (
    <Shell theme={theme}>
      <HanteraClient
        token={token}
        slug={booking.restaurant.slug}
        restaurantName={booking.restaurant.name}
        phone={
          config.voiceAgent.transferNumber ||
          config.voiceAgent.phoneNumber ||
          null
        }
        status={status}
        initialDate={bookingDate}
        initialTime={fmtTime.format(booking.startsAt)}
        initialParty={booking.partySize}
        initialAllergy={booking.allergyNote ?? ""}
        cardLast4={booking.cardLast4}
        guestName={booking.guest.name}
        policy={{
          noShowFeePerGuest: config.noShowFeePerGuest,
          cancellationWindowHours: config.cancellationWindowHours,
          cardGuaranteeRequired: config.cardGuaranteeRequired,
        }}
        withinWindow={insideCancellationWindow(booking.startsAt, config)}
        deadlineText={
          booking.status === "PENDING"
            ? formatDeadlineTime(deadline, config.timezone)
            : null
        }
        openDays={openDays}
        maxParty={Math.min(config.escalationPartySize, 8)}
      />
    </Shell>
  );
}

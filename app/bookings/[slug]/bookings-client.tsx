"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getBrowserSupabase } from "@/lib/auth/client";
import { Avatar } from "@/app/components/avatar";
import { BrandLogo } from "@/app/components/brand-logo";
import {
  GRID_W,
  GRID_H,
  CELL,
  FOOTPRINT,
  chairPositions,
  toShape,
  type Shape,
} from "@/lib/floor-plan";
import type { Booking, PolicyConfig } from "./booking-types";
import {
  PendingCardPanel,
  ChargedPanel,
  CancelledPanel,
} from "./booking-panels";
import { NoShowModal } from "./noshow-modal";
import { CancelDialog } from "./cancel-dialog";

// BLA-31: den operativa dagvyn. Bordskartan (read-only-layout) visar dagens
// bokningar vid vald tidpunkt, uppdateras i realtid via Supabase postgres_changes,
// och personalen kan checka in gäster, släppa bord och drag-and-droppa
// bokningar mellan bord. Auto-tilldelningen sker redan vid bokningstillfället;
// BLA-10:s exclusion constraint skyddar även manuella flyttar.

const GRACE_MINUTES = 15;
const OCCUPYING = new Set(["PENDING", "CONFIRMED", "SEATED"]);

const SOURCE_LABELS: Record<string, string> = {
  widget: "Widget",
  concierge: "AI-mejl",
  dropin: "Drop-in",
  human: "Manuell",
};

type Room = { id: string; name: string };
type TableRow = {
  id: string;
  roomId: string | null;
  name: string;
  capacity: number;
  minSeats: number;
  shape: string;
  posX: number;
  posY: number;
};
type DayData = {
  restaurantId: string;
  rooms: Room[];
  tables: TableRow[];
  bookings: Booking[];
};

type DayHoursRange = { open: string; close: string };

type Props = {
  slug: string;
  restaurantId: string;
  restaurantName: string;
  openingHours: Record<string, DayHoursRange[]>;
  policy: PolicyConfig;
};

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const STATUS_META: Record<string, { label: string; classes: string }> = {
  PENDING: {
    // Preliminär (§3.3): väntar på kortbekräftelse — samma status bär även
    // AI-mejlbokningar som väntar på personal
    label: "Preliminär",
    classes:
      "border-status-pending-border bg-status-pending-bg text-status-pending-fg",
  },
  CONFIRMED: {
    label: "Bekräftad",
    classes:
      "border-status-booked-border bg-status-booked-bg text-status-booked-fg",
  },
  SEATED: {
    label: "Sitter",
    classes:
      "border-status-seated-border bg-status-seated-bg text-status-seated-fg",
  },
  COMPLETED: {
    label: "Genomförd",
    classes: "border-status-done-border bg-status-done-bg text-status-done-fg",
  },
  CANCELLED: {
    label: "Avbokad",
    classes: "border-status-done-border bg-status-done-bg text-status-done-fg",
  },
  NO_SHOW: {
    label: "Utebliven",
    classes: "border-status-late-border bg-status-late-bg text-status-late-fg",
  },
};

function todayLocal(): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
  }).format(new Date());
  return parts; // sv-SE ger YYYY-MM-DD
}

function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minuter sedan bokad starttid (negativt = framtid). Browser-lokal tid. */
function minutesSinceStart(booking: Booking, now: number): number {
  return Math.floor((now - new Date(booking.startsAt).getTime()) / 60_000);
}

export function BookingsClient({
  slug,
  restaurantId,
  restaurantName,
  openingHours,
  policy,
}: Props) {
  const [date, setDate] = useState(() => todayLocal());
  const [data, setData] = useState<DayData | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState(false);
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  // --- Datahämtning: initial + refetch vid realtime-event/fokus ---
  const fetchDay = useCallback(
    async (d: string) => {
      try {
        const res = await fetch(`/api/restaurants/${slug}/day?date=${d}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Kunde inte hämta bokningar.");
          return;
        }
        const day: DayData = await res.json();
        setData(day);
        setActiveRoomId((prev) =>
          prev && day.rooms.some((r) => r.id === prev)
            ? prev
            : (day.rooms[0]?.id ?? null),
        );
      } catch {
        setError("Kunde inte hämta bokningar.");
      }
    },
    [slug],
  );

  useEffect(() => {
    const id = setTimeout(() => void fetchDay(date), 0);
    return () => clearTimeout(id);
  }, [date, fetchDay]);

  // --- Supabase Realtime: bookings-ändringar för denna restaurang ---
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel(`bookings-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => void fetchDay(dateRef.current),
      )
      .subscribe((status: string) => setLive(status === "SUBSCRIBED"));

    const onFocus = () => void fetchDay(dateRef.current);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [restaurantId, fetchDay]);

  // Ticker för countdowns/försenad-status
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // --- Tidsskrubber: 30-min-steg över dagens öppettider ---
  const weekday = WEEKDAY_KEYS[new Date(`${date}T12:00:00`).getDay()];
  const timeSlots = useMemo(() => {
    const ranges = openingHours[weekday] ?? [];
    const slots: number[] = [];
    for (const r of ranges) {
      const close = minutesOfDay(r.close);
      for (let m = minutesOfDay(r.open); m < close; m += 30) slots.push(m);
    }
    return slots;
  }, [openingHours, weekday]);

  const effectiveTime = useMemo(() => {
    if (selectedTime !== null && timeSlots.includes(selectedTime))
      return selectedTime;
    if (timeSlots.length === 0) return null;
    if (date === todayLocal()) {
      const nowM = new Date().getHours() * 60 + new Date().getMinutes();
      const current = [...timeSlots].reverse().find((s) => s <= nowM);
      if (current !== undefined) return current;
    }
    return timeSlots[0];
  }, [selectedTime, timeSlots, date]);

  // --- Ögonblicksbild: vilken bokning sitter på vilket bord vid vald tid ---
  const occupancy = useMemo(() => {
    const map = new Map<string, Booking>(); // tableId → bokning
    if (!data || effectiveTime === null) return map;
    const t = new Date(`${date}T${formatMinutes(effectiveTime)}:00`).getTime();
    for (const b of data.bookings) {
      if (!b.tableId || !OCCUPYING.has(b.status)) continue;
      if (new Date(b.startsAt).getTime() <= t && t < new Date(b.endsAt).getTime()) {
        map.set(b.tableId, b);
      }
    }
    return map;
  }, [data, date, effectiveTime]);

  const roomTables = (data?.tables ?? []).filter(
    (t) => t.roomId === activeRoomId,
  );
  const selectedBooking =
    data?.bookings.find((b) => b.id === selectedBookingId) ?? null;

  /** Markera bokningen OCH hoppa skrubbern till dess tid — så syns
   *  statusändringar (Anlänt → grönt bord) direkt på kartan. */
  const focusBooking = useCallback(
    (b: Booking) => {
      setSelectedBookingId(b.id);
      const local = new Date(b.startsAt);
      const slot = Math.floor((local.getHours() * 60 + local.getMinutes()) / 30) * 30;
      if (timeSlots.includes(slot)) setSelectedTime(slot);
      const table = data?.tables.find((t) => t.id === b.tableId);
      if (table?.roomId) setActiveRoomId(table.roomId);
    },
    [timeSlots, data],
  );

  // --- Åtgärder ---
  const patchBooking = useCallback(
    async (
      id: string,
      body: {
        tableId?: string;
        status?: string;
        guestId?: string;
        arrivedCount?: number;
        staffNote?: string | null;
        date?: string;
        time?: string;
        endTime?: string;
        reactivate?: boolean;
        chargeNoShowFee?: boolean;
      },
    ) => {
      setError(null);
      const res = await fetch(`/api/restaurants/${slug}/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Ändringen misslyckades.");
      }
      await fetchDay(dateRef.current);
      return res.ok;
    },
    [slug, fetchDay],
  );

  // --- Drag & drop: från kartan (bord → bord) och från listan (kort → bord) ---
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{
    bookingId: string;
    fromTableId: string;
    px: number;
    py: number;
    startPx: number;
    startPy: number;
    moved: boolean;
    targetTableId: string | null;
  } | null>(null);
  const [modalBookingId, setModalBookingId] = useState<string | null>(null);
  const modalBooking =
    data?.bookings.find((b) => b.id === modalBookingId) ?? null;
  const [dropInOpen, setDropInOpen] = useState(false);
  const [newBookingOpen, setNewBookingOpen] = useState(false);
  // No-show- och avbokningsdialogerna (§3.4, §3.5) — id-baserade så en
  // realtime-refetch aldrig klipper pågående dialog
  const [noShowForId, setNoShowForId] = useState<string | null>(null);
  const [cancelForId, setCancelForId] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [attachBookingId, setAttachBookingId] = useState<string | null>(null);
  const [listDrag, setListDrag] = useState<{
    bookingId: string;
    x: number; // viewport-koordinater för spök-chipet
    y: number;
    targetTableId: string | null; // giltigt släppmål
    hoverTableId: string | null; // bordet under pekaren, även ogiltigt
    hoverLabel: string; // "T11" eller "T11 · rymmer bara 6"
    hoverValid: boolean;
  } | null>(null);

  const draggedBookingId = drag?.bookingId ?? listDrag?.bookingId ?? null;

  const validTargets = useMemo(() => {
    if (!draggedBookingId || !data) return new Set<string>();
    const booking = data.bookings.find((b) => b.id === draggedBookingId);
    if (!booking) return new Set<string>();
    const start = new Date(booking.startsAt).getTime();
    const end = new Date(booking.endsAt).getTime();
    const targets = new Set<string>();
    for (const table of roomTables) {
      if (table.id === booking.tableId) continue;
      if (table.capacity < booking.partySize) continue;
      const busy = data.bookings.some(
        (b) =>
          b.id !== booking.id &&
          b.tableId === table.id &&
          OCCUPYING.has(b.status) &&
          new Date(b.startsAt).getTime() < end &&
          new Date(b.endsAt).getTime() > start,
      );
      if (!busy) targets.add(table.id);
    }
    return targets;
  }, [draggedBookingId, data, roomTables]);

  function pointerToSvg(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * GRID_W * CELL,
      py: ((e.clientY - rect.top) / rect.height) * GRID_H * CELL,
    };
  }

  function tableAtPoint(px: number, py: number): TableRow | null {
    for (const t of roomTables) {
      const shape = toShape(t.shape);
      const { w, h } = FOOTPRINT[shape];
      if (
        px >= t.posX * CELL &&
        px <= (t.posX + w) * CELL &&
        py >= t.posY * CELL &&
        py <= (t.posY + h) * CELL
      )
        return t;
    }
    return null;
  }

  function onTablePointerDown(e: React.PointerEvent, table: TableRow) {
    const booking = occupancy.get(table.id);
    if (!booking) return;
    e.preventDefault();
    setSelectedBookingId(booking.id);
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    const { px, py } = pointerToSvg(e);
    setDrag({
      bookingId: booking.id,
      fromTableId: table.id,
      px,
      py,
      startPx: px,
      startPy: py,
      moved: false,
      targetTableId: null,
    });
  }

  function onTablePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const { px, py } = pointerToSvg(e);
    const over = tableAtPoint(px, py);
    // Rörelsetröskel skiljer klick (→ modal) från drag (→ flytt)
    const moved =
      drag.moved ||
      Math.hypot(px - drag.startPx, py - drag.startPy) > 6;
    setDrag({
      ...drag,
      px,
      py,
      moved,
      targetTableId: over && validTargets.has(over.id) ? over.id : null,
    });
  }

  async function onTablePointerUp() {
    if (!drag) return;
    const { bookingId, targetTableId, moved } = drag;
    setDrag(null);
    if (moved) {
      if (targetTableId) {
        await patchBooking(bookingId, { tableId: targetTableId });
      }
      return;
    }
    // Rent klick: öppna bokningsmodalen
    const booking = data?.bookings.find((b) => b.id === bookingId);
    if (booking && OCCUPYING.has(booking.status)) {
      setModalBookingId(bookingId);
    }
  }

  // --- Drag från bokningslistan till ett bord på kartan ---
  function clientPointToTable(clientX: number, clientY: number): TableRow | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      return null;
    const px = ((clientX - rect.left) / rect.width) * GRID_W * CELL;
    const py = ((clientY - rect.top) / rect.height) * GRID_H * CELL;
    return tableAtPoint(px, py);
  }

  function onListDragStart(e: React.PointerEvent, b: Booking) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // OBS: inte focusBooking här — den byter rumsflik till bokningens
    // nuvarande rum och skulle rycka undan kartan mitt i dragget
    setSelectedBookingId(b.id);
    setListDrag({
      bookingId: b.id,
      x: e.clientX,
      y: e.clientY,
      targetTableId: null,
      hoverTableId: null,
      hoverLabel: "",
      hoverValid: false,
    });
  }

  function onListDragMove(e: React.PointerEvent, b: Booking) {
    if (!listDrag || listDrag.bookingId !== b.id) return;
    // Håll dragget över en rumsflik → kartan byter rum (cross-room-flytt)
    const tabEl = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-room-id]");
    const hoveredRoomId = tabEl?.getAttribute("data-room-id");
    if (hoveredRoomId && hoveredRoomId !== activeRoomId) {
      setActiveRoomId(hoveredRoomId);
    }
    const over = clientPointToTable(e.clientX, e.clientY);
    let targetTableId: string | null = null;
    let hoverLabel = "";
    let hoverValid = false;
    if (over) {
      if (validTargets.has(over.id)) {
        targetTableId = over.id;
        hoverLabel = over.name;
        hoverValid = true;
      } else if (over.id === b.tableId) {
        hoverLabel = `${over.name} · nuvarande bord`;
      } else if (over.capacity < b.partySize) {
        hoverLabel = `${over.name} · rymmer bara ${over.capacity}`;
      } else {
        hoverLabel = `${over.name} · upptaget`;
      }
    }
    setListDrag({
      bookingId: b.id,
      x: e.clientX,
      y: e.clientY,
      targetTableId,
      hoverTableId: over?.id ?? null,
      hoverLabel,
      hoverValid,
    });
  }

  async function onListDragEnd() {
    if (!listDrag) return;
    const { bookingId, targetTableId } = listDrag;
    setListDrag(null);
    if (targetTableId) {
      await patchBooking(bookingId, { tableId: targetTableId });
    }
  }

  const formatClock = (iso: string) =>
    new Date(iso).toLocaleTimeString("sv-SE", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="min-h-dvh bg-[var(--w-bg)] text-[var(--w-ink)]">
      <header className="flex h-16 items-center gap-4 border-b border-[var(--w-line)] px-6">
        <Link href={`/dashboard/${slug}`} aria-label="Till översikten">
          <BrandLogo />
        </Link>
        <Link
          href={`/dashboard/${slug}`}
          className="text-xs mt-2 text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
        >
          ‹ Översikt
        </Link>
        <span
          className={`mt-2 flex items-center gap-1.5 text-[11px] ${live ? "text-status-seated-fg" : "text-[var(--w-muted)]"}`}
          title={live ? "Realtidsuppdatering aktiv" : "Ansluter…"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${live ? "bg-status-seated-dot" : "bg-[var(--w-muted)]"}`}
          />
          {live ? "Live" : "Ansluter"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {error && <span className="max-w-md text-xs text-yellow-400">{error}</span>}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedTime(null);
              setSelectedBookingId(null);
            }}
            className="h-10 rounded-xl border border-[var(--w-line)] bg-[var(--w-panel)] px-3 text-sm focus:border-[var(--w-accent)] focus:outline-none"
          />
          <button
            onClick={() => setNewBookingOpen(true)}
            className="h-11 rounded-xl border border-[var(--w-line)] px-4 text-sm font-semibold text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] transition"
          >
            Ny bokning
          </button>
          <button
            onClick={() => setDropInOpen(true)}
            className="h-11 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-accent-on shadow-lg shadow-black/25 hover:brightness-110 transition"
          >
            + Drop-in
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
          Bokningar
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          {restaurantName}
        </h1>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Vänster: rum, skrubber, karta */}
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(data?.rooms ?? []).map((room) => (
                <button
                  key={room.id}
                  data-room-id={room.id}
                  onClick={() => setActiveRoomId(room.id)}
                  className={`h-9 rounded-lg border px-3 text-sm transition-colors ${
                    room.id === activeRoomId
                      ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10 text-[var(--w-accent)]"
                      : "border-[var(--w-line)] bg-[var(--w-panel)] text-[var(--w-muted)] hover:text-[var(--w-ink)]"
                  }`}
                >
                  {room.name}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-3 text-[11px] text-[var(--w-muted)]">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border border-[var(--w-line)] bg-[var(--w-panel)]" />
                  Ledig
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-pending-dot" />
                  Preliminär
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-booked-dot" />
                  Bokad
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-seated-dot" />
                  Sitter
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-status-late-dot" />
                  Försenad
                </span>
              </span>
            </div>

            {/* Tidsskrubber */}
            {timeSlots.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {timeSlots.map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectedTime(m)}
                    className={`h-8 rounded-lg border px-2.5 font-mono text-xs transition-colors ${
                      m === effectiveTime
                        ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10 text-[var(--w-accent)]"
                        : "border-[var(--w-line)] text-[var(--w-muted)] hover:text-[var(--w-ink)]"
                    }`}
                  >
                    {formatMinutes(m)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--w-muted)]">
                Stängt denna dag — bokningslistan visas ändå.
              </p>
            )}

            {/* Kartan */}
            <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)]">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${GRID_W * CELL} ${GRID_H * CELL}`}
                className="h-auto w-full touch-none select-none"
              >
                <defs>
                  <pattern
                    id="day-dots"
                    width={CELL}
                    height={CELL}
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx={CELL / 2} cy={CELL / 2} r={1.3} fill="var(--w-line)" />
                  </pattern>
                </defs>
                <rect
                  width={GRID_W * CELL}
                  height={GRID_H * CELL}
                  fill="url(#day-dots)"
                />
                {roomTables.map((table) => (
                  <DayTableGlyph
                    key={table.id}
                    table={table}
                    booking={occupancy.get(table.id) ?? null}
                    hasLaterBooking={(data?.bookings ?? []).some(
                      (b) =>
                        b.tableId === table.id &&
                        OCCUPYING.has(b.status) &&
                        effectiveTime !== null &&
                        new Date(b.startsAt).getTime() >
                          new Date(
                            `${date}T${formatMinutes(effectiveTime)}:00`,
                          ).getTime(),
                    )}
                    now={now}
                    selected={
                      !!selectedBooking &&
                      occupancy.get(table.id)?.id === selectedBooking.id
                    }
                    isDragTarget={
                      (drag?.targetTableId ?? listDrag?.targetTableId) === table.id
                    }
                    isValidTarget={validTargets.has(table.id)}
                    isInvalidHover={
                      listDrag?.hoverTableId === table.id && !listDrag.hoverValid
                    }
                    dragging={draggedBookingId !== null}
                    onPointerDown={(e) => onTablePointerDown(e, table)}
                    onPointerMove={onTablePointerMove}
                    onPointerUp={() => void onTablePointerUp()}
                  />
                ))}
                {/* Ghost-chip som följer pekaren vid drag */}
                {drag && data && (
                  <g style={{ pointerEvents: "none" }} opacity={0.9}>
                    <rect
                      x={drag.px - 52}
                      y={drag.py - 14}
                      width={104}
                      height={28}
                      rx={14}
                      fill="var(--bg-hover)"
                      stroke="var(--w-accent)"
                    />
                    <text
                      x={drag.px}
                      y={drag.py + 4}
                      textAnchor="middle"
                      fontSize={10.5}
                      fill="var(--w-ink)"
                    >
                      {data.bookings
                        .find((b) => b.id === drag.bookingId)
                        ?.guestName.slice(0, 14) ?? ""}
                    </text>
                  </g>
                )}
              </svg>
            </div>
            <p className="mt-2 text-xs text-[var(--w-muted)]">
              Dra ⠿-handtaget på en bokning i listan (eller ett upptaget bord på
              kartan) till ett annat bord — giltiga bord tänds gröna.
            </p>
          </div>

          {/* Höger: dagens bokningslista */}
          <aside>
            <h2 className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
              Dagens bokningar ({(data?.bookings ?? []).length})
            </h2>
            <div className="mt-3 space-y-2">
              {(data?.bookings ?? []).length === 0 && (
                <p className="text-sm text-[var(--w-muted)]">
                  Inga bokningar denna dag.
                </p>
              )}
              {(data?.bookings ?? []).map((b) => {
                const meta = STATUS_META[b.status] ?? STATUS_META.PENDING;
                const table = data?.tables.find((t) => t.id === b.tableId);
                const late =
                  date === todayLocal() &&
                  (b.status === "PENDING" || b.status === "CONFIRMED") &&
                  minutesSinceStart(b, now) > 0;
                const sinceStart = minutesSinceStart(b, now);
                const draggable = OCCUPYING.has(b.status) && b.tableId;
                return (
                  <div
                    key={b.id}
                    onClick={() => {
                      focusBooking(b);
                      setModalBookingId(b.id);
                    }}
                    className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                      selectedBookingId === b.id
                        ? "border-[var(--w-accent)] bg-[var(--w-accent)]/5"
                        : "border-[var(--w-line)] bg-[var(--w-panel)] hover:border-[var(--w-muted)]"
                    } ${b.status === "CANCELLED" ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <Avatar name={b.guestName} size={40} />
                        {draggable && (
                          <span
                            onPointerDown={(e) => onListDragStart(e, b)}
                            onPointerMove={(e) => onListDragMove(e, b)}
                            onPointerUp={() => void onListDragEnd()}
                            // Släppet avfyrar ett click som annars bubblar till
                            // kortets onClick → focusBooking → flikbyte till
                            // bokningens GAMLA rum mitt i släppet
                            onClick={(e) => e.stopPropagation()}
                            title="Dra till ett bord på kartan"
                            className="cursor-grab touch-none select-none rounded px-2 py-1 text-[var(--w-muted)] hover:text-[var(--w-accent)]"
                          >
                            ⠿
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {b.guestName}
                          </span>
                          <span className="font-mono text-sm">
                            {formatClock(b.startsAt)}
                          </span>
                          <span className="ml-auto shrink-0 text-xs text-[var(--w-muted)]">
                            {b.partySize} pers · {table?.name ?? "—"} ·{" "}
                            {SOURCE_LABELS[b.createdBy] ?? "AI-mejl"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.classes}`}
                          >
                            {meta.label}
                          </span>
                          {b.childrenCount > 0 && (
                            <span className="text-[10px] text-[var(--w-muted)]">
                              varav {b.childrenCount} barn
                            </span>
                          )}
                          {b.allergyNote && (
                            <span className="rounded-full border border-status-late-border bg-status-late-bg px-2 py-0.5 text-[10px] font-medium text-status-late-fg">
                              Allergi
                            </span>
                          )}
                          {b.guestName === "Drop-in" && OCCUPYING.has(b.status) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttachBookingId(b.id);
                              }}
                              className="rounded-lg border border-[var(--w-accent)]/50 px-2 py-0.5 text-[10px] font-medium text-[var(--w-accent)] hover:bg-[var(--w-accent)]/10 transition"
                            >
                              Koppla kund
                            </button>
                          )}
                          {late && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                sinceStart <= GRACE_MINUTES
                                  ? "border-status-grace-border bg-status-grace-bg text-status-grace-fg"
                                  : "border-status-late-border bg-status-late-bg text-status-late-fg"
                              }`}
                            >
                              {sinceStart <= GRACE_MINUTES
                                ? `Släpps om ${GRACE_MINUTES - sinceStart} min`
                                : `Försenad ${sinceStart} min`}
                            </span>
                          )}
                        </div>
                        {/* Åtgärdsrad — 44 pt träffytor (iPad under service).
                            No-show och Avboka går ALLTID via dialogerna
                            (§3.4/§3.5) — debitering resp. väntelistematch. */}
                        <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                          {b.status === "PENDING" && (
                            <ActionButton
                              label="Bekräfta"
                              tone="green"
                              onClick={() => {
                                focusBooking(b);
                                void patchBooking(b.id, {
                                  status: "CONFIRMED",
                                });
                              }}
                            />
                          )}
                          {(b.status === "PENDING" ||
                            b.status === "CONFIRMED") && (
                            <>
                              <ActionButton
                                label="Anlänt"
                                tone="green"
                                onClick={() => {
                                  focusBooking(b);
                                  void patchBooking(b.id, {
                                    status: "SEATED",
                                  });
                                }}
                              />
                              {late && (
                                <ActionButton
                                  label="No-show…"
                                  tone="red"
                                  onClick={() => {
                                    focusBooking(b);
                                    setNoShowForId(b.id);
                                  }}
                                />
                              )}
                              <ActionButton
                                label="Avboka…"
                                tone="neutral"
                                onClick={() => {
                                  focusBooking(b);
                                  setCancelForId(b.id);
                                }}
                              />
                            </>
                          )}
                          {b.status === "SEATED" && (
                            <ActionButton
                              label="Avsluta"
                              tone="neutral"
                              onClick={() => {
                                focusBooking(b);
                                void patchBooking(b.id, {
                                  status: "COMPLETED",
                                });
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </main>

      {/* Bokningsmodal: klick på kort i listan eller upptaget bord på kartan */}
      {modalBooking && (
        <BookingModal
          key={modalBooking.id}
          booking={modalBooking}
          date={date}
          tableName={
            data?.tables.find((t) => t.id === modalBooking.tableId)?.name ?? "Bord"
          }
          now={now}
          slug={slug}
          policy={policy}
          patchBooking={patchBooking}
          onNoShow={() => setNoShowForId(modalBooking.id)}
          onCancel={() => setCancelForId(modalBooking.id)}
          onClose={() => setModalBookingId(null)}
        />
      )}

      {/* No-show-dialogen (§3.4): med/utan kort, debitering via PSP-stubben */}
      {(() => {
        const b = data?.bookings.find((x) => x.id === noShowForId);
        if (!b) return null;
        return (
          <NoShowModal
            booking={b}
            policy={policy}
            busy={dialogBusy}
            onCharge={() => {
              setDialogBusy(true);
              void patchBooking(b.id, {
                status: "NO_SHOW",
                chargeNoShowFee: true,
              }).finally(() => {
                setDialogBusy(false);
                setNoShowForId(null);
                setModalBookingId(null);
              });
            }}
            onNoCharge={() => {
              setDialogBusy(true);
              void patchBooking(b.id, { status: "NO_SHOW" }).finally(() => {
                setDialogBusy(false);
                setNoShowForId(null);
                setModalBookingId(null);
              });
            }}
            onClose={() => setNoShowForId(null)}
          />
        );
      })()}

      {/* Avbokningsdialogen (§3.5): policyrad + väntelistematch */}
      {(() => {
        const b = data?.bookings.find((x) => x.id === cancelForId);
        if (!b) return null;
        return (
          <CancelDialog
            slug={slug}
            booking={b}
            policy={policy}
            busy={dialogBusy}
            onCancel={() => {
              setDialogBusy(true);
              void patchBooking(b.id, { status: "CANCELLED" }).finally(() => {
                setDialogBusy(false);
                setCancelForId(null);
                setModalBookingId(null);
              });
            }}
            onCancelAndOffer={(entryId, offeredTime) => {
              setDialogBusy(true);
              void (async () => {
                const ok = await patchBooking(b.id, { status: "CANCELLED" });
                if (ok) {
                  // Erbjudandet är en separat personalhandling — faller det
                  // ligger posten kvar som Väntar (ofarligt)
                  await fetch(
                    `/api/restaurants/${slug}/waitlist/${entryId}/offer`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ time: offeredTime }),
                    },
                  ).catch(() => {});
                  await fetchDay(dateRef.current);
                }
              })().finally(() => {
                setDialogBusy(false);
                setCancelForId(null);
                setModalBookingId(null);
              });
            }}
            onClose={() => setCancelForId(null)}
          />
        );
      })()}

      {/* Ny bokning: namn + telefon för ny gäst inline */}
      {newBookingOpen && data && (
        <NewBookingModal
          slug={slug}
          date={date}
          timeSlots={timeSlots}
          tables={data.tables}
          rooms={data.rooms}
          onClose={() => setNewBookingOpen(false)}
          onCreated={() => {
            setNewBookingOpen(false);
            void fetchDay(dateRef.current);
          }}
        />
      )}

      {/* Drop-in: personalens direktbokning (bypassar gästspärrarna) */}
      {dropInOpen && data && (
        <DropInModal
          slug={slug}
          date={date}
          timeSlots={timeSlots}
          tables={data.tables}
          rooms={data.rooms}
          onClose={() => setDropInOpen(false)}
          onCreated={() => {
            setDropInOpen(false);
            void fetchDay(dateRef.current);
          }}
        />
      )}

      {/* Koppla drop-in-bokning till en riktig kund */}
      {attachBookingId && (
        <AttachGuestModal
          slug={slug}
          onClose={() => setAttachBookingId(null)}
          onAttach={async (guestId) => {
            const id = attachBookingId;
            setAttachBookingId(null);
            await patchBooking(id, { guestId });
          }}
        />
      )}

      {/* Spök-chip som följer pekaren när en bokning dras från listan —
          visar även VARFÖR ett bord inte går att släppa på */}
      {listDrag && data && (
        <div
          className={`pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-hoverbg px-3 py-1.5 text-xs shadow-lg ${
            listDrag.hoverTableId && !listDrag.hoverValid
              ? "border-status-late-border text-status-late-fg"
              : "border-[var(--w-accent)] text-[var(--w-ink)]"
          }`}
          style={{ left: listDrag.x, top: listDrag.y }}
        >
          {data.bookings.find((b) => b.id === listDrag.bookingId)?.guestName}
          {listDrag.hoverLabel ? ` → ${listDrag.hoverLabel}` : ""}
        </div>
      )}
    </div>
  );
}

function BookingModal({
  booking,
  date,
  tableName,
  now,
  slug,
  policy,
  patchBooking,
  onNoShow,
  onCancel,
  onClose,
}: {
  booking: Booking;
  date: string;
  tableName: string;
  now: number;
  slug: string;
  policy: PolicyConfig;
  patchBooking: (
    id: string,
    body: {
      status?: string;
      arrivedCount?: number;
      staffNote?: string | null;
      date?: string;
      time?: string;
      endTime?: string;
      reactivate?: boolean;
    },
  ) => Promise<boolean>;
  onNoShow: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString("sv-SE", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

  // Lokal redigeringsbuffert (monteras om per bokning via key={booking.id}) —
  // realtime-refetchar får inte skriva över pågående inmatning
  const [fromTime, setFromTime] = useState(() => clock(booking.startsAt));
  const [toTime, setToTime] = useState(() => clock(booking.endsAt));
  const [note, setNote] = useState(booking.staffNote ?? "");
  const [arrived, setArrived] = useState(
    booking.arrivedCount ?? booking.partySize,
  );
  const [busy, setBusy] = useState(false);

  const seatedMinutes = booking.seatedAt
    ? Math.max(0, Math.floor((now - new Date(booking.seatedAt).getTime()) / 60_000))
    : null;
  const meta = STATUS_META[booking.status] ?? STATUS_META.PENDING;
  const active = OCCUPYING.has(booking.status);

  async function saveTimes() {
    if (
      fromTime === clock(booking.startsAt) &&
      toTime === clock(booking.endsAt)
    )
      return;
    setBusy(true);
    const ok = await patchBooking(booking.id, {
      date,
      time: fromTime,
      endTime: toTime,
    });
    setBusy(false);
    if (!ok) {
      setFromTime(clock(booking.startsAt));
      setToTime(clock(booking.endsAt));
    }
  }

  async function saveArrived(next: number) {
    const clamped = Math.max(0, Math.min(50, next));
    setArrived(clamped);
    await patchBooking(booking.id, { arrivedCount: clamped });
  }

  async function saveNote() {
    if ((booking.staffNote ?? "") === note.trim()) return;
    await patchBooking(booking.id, { staffNote: note.trim() || null });
  }

  async function setStatus(status: string) {
    setBusy(true);
    const ok = await patchBooking(booking.id, { status });
    setBusy(false);
    if (ok && (status === "COMPLETED" || status === "CANCELLED" || status === "NO_SHOW"))
      onClose();
  }

  const timeInputClass =
    "mt-1 w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-2 font-mono text-sm focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Bokning för ${booking.guestName}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={booking.guestName} size={46} />
            <div>
              <h3 className="text-xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
                {booking.guestName}
              </h3>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]">
                {tableName} · {booking.partySize} pers
                {booking.childrenCount > 0
                  ? ` · varav ${booking.childrenCount} barn`
                  : ""}
              </p>
            </div>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.classes}`}
          >
            {meta.label}
          </span>
        </div>

        {/* Tid: Från/Till — validering mot öppettider + krockar sker i API:t */}
        {active && (
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <label>
              <span className="text-xs text-[var(--w-muted)]">Från</span>
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                onBlur={() => void saveTimes()}
                className={timeInputClass}
              />
            </label>
            <label>
              <span className="text-xs text-[var(--w-muted)]">Till</span>
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                onBlur={() => void saveTimes()}
                className={timeInputClass}
              />
            </label>
          </div>
        )}

        <dl className="mt-5 space-y-3 text-sm">
          {booking.seatedAt && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--w-muted)]">Anlände</dt>
                <dd className="font-mono">{clock(booking.seatedAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--w-muted)]">Har suttit</dt>
                <dd className="font-mono">
                  {seatedMinutes !== null ? `${seatedMinutes} min` : "—"}
                </dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--w-muted)]">Bokningen gjordes</dt>
            <dd>{dateTime(booking.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--w-muted)]">Kort</dt>
            <dd className="font-mono">
              {booking.cardLast4 ? `•••• ${booking.cardLast4}` : "Saknas"}
            </dd>
          </div>
          {booking.notes && (
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--w-muted)]">Önskemål</dt>
              <dd className="text-right">{booking.notes}</dd>
            </div>
          )}
          {booking.allergyNote && (
            <div className="flex justify-between gap-4">
              <dt className="text-status-late-fg">Allergi</dt>
              <dd className="text-right font-medium text-status-late-fg">
                {booking.allergyNote}
              </dd>
            </div>
          )}
        </dl>

        {/* Statuspaneler: gul (väntar på kort), röd (avgift debiterad),
            grå (avbokad + återaktivering) — POC:ns paneler (§3.3–3.5) */}
        {booking.status === "PENDING" && (
          <PendingCardPanel booking={booking} policy={policy} slug={slug} />
        )}
        <ChargedPanel booking={booking} />
        {booking.status === "CANCELLED" && (
          <CancelledPanel
            booking={booking}
            policy={policy}
            busy={busy}
            onReactivate={() => {
              setBusy(true);
              void patchBooking(booking.id, { reactivate: true }).finally(() =>
                setBusy(false),
              );
            }}
          />
        )}

        {/* Antal anlända — kan skilja sig från bokat antal */}
        {active && (
          <div className="mt-5">
            <span className="text-xs text-[var(--w-muted)]">
              Antal gäster anlända
            </span>
            <div className="mt-1 flex items-center gap-3">
              <button
                onClick={() => void saveArrived(arrived - 1)}
                disabled={arrived <= 0}
                aria-label="Färre anlända"
                className="h-11 w-11 rounded-lg border border-[var(--w-line)] text-lg text-[var(--w-muted)] hover:text-[var(--w-ink)] disabled:opacity-40 transition"
              >
                −
              </button>
              <span className="w-8 text-center font-mono text-lg">
                {arrived}
              </span>
              <button
                onClick={() => void saveArrived(arrived + 1)}
                disabled={arrived >= 50}
                aria-label="Fler anlända"
                className="h-11 w-11 rounded-lg border border-[var(--w-line)] text-lg text-[var(--w-muted)] hover:text-[var(--w-ink)] disabled:opacity-40 transition"
              >
                +
              </button>
              <span className="text-xs text-[var(--w-muted)]">
                av {booking.partySize} bokade — kan skilja sig från
                ursprungligt antal
              </span>
            </div>
          </div>
        )}

        {/* Personalens anteckning — separat från gästens önskemål */}
        <div className="mt-5">
          <span className="text-xs text-[var(--w-muted)]">Anteckning</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void saveNote()}
            maxLength={500}
            rows={2}
            placeholder="Skriv en egen anteckning om bokningen…"
            className="mt-1 w-full resize-none rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-3 py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none"
          />
        </div>

        {/* Åtgärder */}
        <div className="mt-5 space-y-2">
          {booking.status === "PENDING" && (
            <button
              onClick={() => void setStatus("CONFIRMED")}
              disabled={busy}
              className="min-h-11 w-full rounded-xl border border-status-seated-border bg-status-seated-bg text-sm font-semibold text-status-seated-fg hover:brightness-110 disabled:opacity-60 transition"
            >
              {policy.cardGuaranteeRequired && !booking.cardLast4
                ? "Bekräfta utan kort"
                : "Bekräfta bokningen"}
            </button>
          )}
          {(booking.status === "PENDING" || booking.status === "CONFIRMED") && (
            <button
              onClick={() => void setStatus("SEATED")}
              disabled={busy}
              className="min-h-11 w-full rounded-xl bg-[var(--w-accent)] text-sm font-semibold text-accent-on hover:brightness-110 disabled:opacity-60 transition"
            >
              Markera som anländ
            </button>
          )}
          {booking.status === "SEATED" && (
            <button
              onClick={() => void setStatus("COMPLETED")}
              disabled={busy}
              className="min-h-11 w-full rounded-xl bg-[var(--w-accent)] text-sm font-semibold text-accent-on hover:brightness-110 disabled:opacity-60 transition"
            >
              Avsluta besöket
            </button>
          )}
          {(booking.status === "PENDING" || booking.status === "CONFIRMED") && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onNoShow}
                className="min-h-11 rounded-xl border border-status-late-border text-sm font-medium text-status-late-fg hover:bg-status-late-bg transition"
              >
                No-show…
              </button>
              <button
                onClick={onCancel}
                className="min-h-11 rounded-xl border border-[#5c3a30] text-sm font-medium text-[#d1786a] hover:bg-status-late-bg transition"
              >
                Avboka…
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="min-h-11 w-full rounded-xl border border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
}

function NewBookingModal({
  slug,
  date,
  timeSlots,
  tables,
  rooms,
  onClose,
  onCreated,
}: {
  slug: string;
  date: string;
  timeSlots: number[];
  tables: TableRow[];
  rooms: Room[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const defaultSlot =
    timeSlots.find((m) => m >= nowM) ?? timeSlots[0] ?? 17 * 60;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [time, setTime] = useState(formatMinutes(defaultSlot));
  const [party, setParty] = useState(2);
  const [tableId, setTableId] = useState<string>(""); // "" = auto
  const [notes, setNotes] = useState("");
  // Preliminär är default (§3.2): kortlänken mejlas, bokningen bekräftas
  // automatiskt när gästen angett kort
  const [status, setStatus] = useState<"PENDING" | "CONFIRMED">("PENDING");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError("Ange gästens namn.");
      return;
    }
    if (status === "PENDING" && !email.trim()) {
      setError("Ange gästens e-post — kortlänken mejlas dit.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          partySize: party,
          ...(tableId ? { tableId } : {}),
          guest: {
            name: name.trim(),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(email.trim() ? { email: email.trim() } : {}),
          },
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          onSite: false,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte skapa bokningen.");
        return;
      }
      onCreated();
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const fitting = tables.filter((t) => t.capacity >= party);
  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Ny bokning"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <h3 className="text-xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          Ny bokning · {date}
        </h3>
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <label className="col-span-2">
            <span className="text-xs text-[var(--w-muted)]">Gästens namn</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="För- och efternamn"
              className={inputClass}
            />
          </label>
          <label className="col-span-2">
            <span className="text-xs text-[var(--w-muted)]">
              Telefon (valfritt)
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="070-123 45 67"
              className={inputClass}
            />
          </label>
          <label className="col-span-2">
            <span className="text-xs text-[var(--w-muted)]">
              E-post{status === "PENDING" ? "" : " (valfritt)"}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="namn@exempel.se"
              className={inputClass}
            />
          </label>
          <label>
            <span className="text-xs text-[var(--w-muted)]">Antal</span>
            <input
              type="number"
              min={1}
              max={50}
              value={party}
              onChange={(e) =>
                setParty(Math.max(1, Number(e.target.value) || 1))
              }
              className={`${inputClass} font-mono`}
            />
          </label>
          <label>
            <span className="text-xs text-[var(--w-muted)]">Tid</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </label>
          <label className="col-span-2">
            <span className="text-xs text-[var(--w-muted)]">Bord</span>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className={inputClass}
            >
              <option value="">Auto (minsta lediga)</option>
              {fitting.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.capacity} pl,{" "}
                  {rooms.find((r) => r.id === t.roomId)?.name ?? "—"})
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2">
            <span className="text-xs text-[var(--w-muted)]">Status</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={status === "PENDING"}
                onClick={() => setStatus("PENDING")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  status === "PENDING"
                    ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10"
                    : "border-[var(--w-line)] hover:border-[var(--w-muted)]"
                }`}
              >
                <span className="block text-sm font-semibold">Preliminär</span>
                <span className="mt-0.5 block text-[11px] text-[var(--w-muted)]">
                  Kortlänk mejlas till gästen
                </span>
              </button>
              <button
                type="button"
                aria-pressed={status === "CONFIRMED"}
                onClick={() => setStatus("CONFIRMED")}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  status === "CONFIRMED"
                    ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10"
                    : "border-[var(--w-line)] hover:border-[var(--w-muted)]"
                }`}
              >
                <span className="block text-sm font-semibold">Bekräftad</span>
                <span className="mt-0.5 block text-[11px] text-[var(--w-muted)]">
                  Godkänns utan kort
                </span>
              </button>
            </div>
            <p className="mt-2 rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--w-muted)]">
              {status === "PENDING"
                ? "Gästen får ett mejl med en säker länk för att ange sitt kortnummer. Bokningen bekräftas automatiskt när kortet registrerats."
                : "Bokningen bekräftas direkt utan kortgaranti — ingen no-show-avgift kan debiteras."}
            </p>
          </div>
          <label className="col-span-2">
            <span className="text-xs text-[var(--w-muted)]">Anteckning</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Allergier, önskemål, tillfälle…"
              className={`${inputClass} resize-none`}
            />
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-yellow-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="min-h-11 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Avbryt
          </button>
          <button
            onClick={() => void create()}
            disabled={saving}
            className="min-h-11 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-accent-on hover:brightness-110 disabled:opacity-60 transition"
          >
            {saving ? "Skapar…" : "Skapa bokning"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "green" | "red" | "neutral";
  onClick: () => void;
}) {
  const tones = {
    green:
      "border-status-seated-border text-status-seated-fg hover:bg-status-seated-bg",
    red: "border-status-late-border text-status-late-fg hover:bg-status-late-bg",
    neutral:
      "border-[var(--w-line)] text-[var(--w-muted)] hover:text-[var(--w-ink)]",
  };
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      // min-h-11 = 44 px — Apples riktlinje för träffytor på iPad under service
      className={`min-h-11 rounded-lg border px-3 text-xs font-medium transition-colors ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

function DayTableGlyph({
  table,
  booking,
  hasLaterBooking,
  now,
  selected,
  isDragTarget,
  isValidTarget,
  isInvalidHover,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  table: TableRow;
  booking: Booking | null;
  hasLaterBooking: boolean;
  now: number;
  selected: boolean;
  isDragTarget: boolean;
  isValidTarget: boolean;
  isInvalidHover: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}) {
  const shape: Shape = toShape(table.shape);
  const { w: fw, h: fh } = FOOTPRINT[shape];
  const x = table.posX * CELL;
  const y = table.posY * CELL;
  const w = fw * CELL;
  const h = fh * CELL;
  const cx = w / 2;
  const cy = h / 2;

  const sinceStart = booking
    ? Math.floor((now - new Date(booking.startsAt).getTime()) / 60_000)
    : 0;
  // Timern räknar från faktisk incheckning (seatedAt), inte bokad tid
  const seatedMinutes =
    booking?.seatedAt != null
      ? Math.max(0, Math.floor((now - new Date(booking.seatedAt).getTime()) / 60_000))
      : null;
  const late =
    booking &&
    (booking.status === "PENDING" || booking.status === "CONFIRMED") &&
    sinceStart > 0;

  let stroke = "var(--status-free-border)";
  let fill = "var(--bg-hover)";
  if (booking) {
    if (booking.status === "SEATED") {
      stroke = "var(--status-seated-dot)";
      fill = "var(--status-seated-bg)";
    } else if (late && sinceStart > GRACE_MINUTES) {
      stroke = "var(--status-late-dot)";
      fill = "var(--status-late-bg)";
    } else if (late) {
      stroke = "var(--status-grace-dot)";
      fill = "var(--status-grace-bg)";
    } else if (booking.status === "PENDING") {
      stroke = "var(--status-pending-dot)";
      fill = "var(--status-pending-bg)";
    } else {
      stroke = "var(--status-booked-dot)";
      fill = "var(--status-booked-bg)";
    }
  }
  if (dragging && isValidTarget) stroke = "var(--status-seated-dot)";
  if (isDragTarget) {
    stroke = "var(--status-seated-dot)";
    fill = "var(--status-seated-bg)";
  }
  if (isInvalidHover) {
    stroke = "var(--status-late-dot)";
    fill = "var(--status-late-bg)";
  }

  const chairs = chairPositions(table.capacity, w, h);
  const inset = 15;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ cursor: booking ? "grab" : "default", outline: "none" }}
      aria-label={
        booking
          ? `${table.name}: ${booking.guestName}, ${booking.partySize} personer`
          : `${table.name}: ledigt`
      }
    >
      {chairs.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={4.5}
          fill="var(--bg-hover)"
          stroke={stroke}
          strokeWidth={1}
        />
      ))}
      {shape === "round" ? (
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(w, h) / 2 - inset}
          fill={fill}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.4}
        />
      ) : (
        <rect
          x={inset}
          y={inset}
          width={w - inset * 2}
          height={h - inset * 2}
          rx={10}
          fill={fill}
          stroke={stroke}
          strokeWidth={selected ? 2.5 : 1.4}
        />
      )}
      <text
        x={cx}
        y={booking ? cy - 8 : cy - 2}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={600}
        fill="var(--w-ink)"
        style={{ pointerEvents: "none" }}
      >
        {table.name}
      </text>
      {booking ? (
        <>
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fontSize={9}
            fill="var(--w-ink)"
            style={{ pointerEvents: "none" }}
          >
            {booking.guestName.slice(0, 13)}
          </text>
          <text
            x={cx}
            y={cy + 15}
            textAnchor="middle"
            fontSize={8}
            fill={
              late
                ? sinceStart > GRACE_MINUTES
                  ? "var(--status-late-fg)"
                  : "var(--status-grace-fg)"
                : "var(--w-muted)"
            }
            style={{ pointerEvents: "none" }}
          >
            {late
              ? sinceStart > GRACE_MINUTES
                ? `Försenad ${sinceStart}m`
                : `Släpps om ${GRACE_MINUTES - sinceStart}m`
              : booking.status === "SEATED"
                ? `Sitter${seatedMinutes !== null ? ` · ${seatedMinutes} min` : ""}`
                : `${booking.partySize} pers`}
          </text>
        </>
      ) : (
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          fontSize={8}
          fill="var(--w-muted)"
          style={{ pointerEvents: "none" }}
        >
          {hasLaterBooking ? "bokad senare" : "ledig"}
        </text>
      )}
    </g>
  );
}

type GuestHit = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string;
};

function DropInModal({
  slug,
  date,
  timeSlots,
  tables,
  rooms,
  onClose,
  onCreated,
}: {
  slug: string;
  date: string;
  timeSlots: number[];
  tables: TableRow[];
  rooms: Room[];
  onClose: () => void;
  onCreated: () => void;
}) {
  // Default: närmaste kommande slot idag, annars första
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const defaultSlot =
    timeSlots.find((m) => m >= nowM) ?? timeSlots[0] ?? 17 * 60;
  const [time, setTime] = useState(formatMinutes(defaultSlot));
  const [party, setParty] = useState(2);
  const [children, setChildren] = useState(0);
  const [tableId, setTableId] = useState<string>(""); // "" = auto
  const [onSite, setOnSite] = useState(true);
  const [guest, setGuest] = useState<GuestHit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          time,
          partySize: party,
          childrenCount: Math.min(children, party),
          ...(tableId ? { tableId } : {}),
          ...(guest ? { guestId: guest.id } : {}),
          onSite,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte skapa bokningen.");
        return;
      }
      onCreated();
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const fitting = tables.filter((t) => t.capacity >= party);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Ny drop-in-bokning"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <h3 className="text-xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          Ny drop-in · {date}
        </h3>
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <label>
            <span className="text-xs text-[var(--w-muted)]">Tid</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-1.5 font-mono text-sm focus:border-[var(--w-accent)] focus:outline-none"
            />
          </label>
          <label>
            <span className="text-xs text-[var(--w-muted)]">Bord</span>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-1.5 text-sm focus:border-[var(--w-accent)] focus:outline-none"
            >
              <option value="">Auto (minsta lediga)</option>
              {fitting.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.capacity} pl,{" "}
                  {rooms.find((r) => r.id === t.roomId)?.name ?? "—"})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-xs text-[var(--w-muted)]">Antal gäster</span>
            <input
              type="number"
              min={1}
              max={50}
              value={party}
              onChange={(e) =>
                setParty(Math.max(1, Number(e.target.value) || 1))
              }
              className="mt-1 w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-1.5 font-mono text-sm focus:border-[var(--w-accent)] focus:outline-none"
            />
          </label>
          <label>
            <span className="text-xs text-[var(--w-muted)]">Varav barn</span>
            <input
              type="number"
              min={0}
              max={party}
              value={children}
              onChange={(e) =>
                setChildren(Math.max(0, Number(e.target.value) || 0))
              }
              className="mt-1 w-full rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-2 py-1.5 font-mono text-sm focus:border-[var(--w-accent)] focus:outline-none"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onSite}
            onChange={(e) => setOnSite(e.target.checked)}
            className="accent-[var(--w-accent)]"
          />
          Gästen är på plats (checkas in direkt)
        </label>

        <div className="mt-4">
          <span className="text-xs text-[var(--w-muted)]">
            Kund (valfritt — kan kopplas i efterhand)
          </span>
          {guest ? (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="rounded-full border border-[var(--w-accent)]/50 bg-[var(--w-accent)]/10 px-3 py-1 text-xs text-[var(--w-accent)]">
                {guest.name ?? guest.email ?? guest.phone}
              </span>
              <button
                onClick={() => setGuest(null)}
                className="text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)]"
              >
                ✕ ta bort
              </button>
            </div>
          ) : (
            <GuestSearch slug={slug} onPick={setGuest} />
          )}
        </div>

        {error && <p className="mt-3 text-xs text-yellow-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Avbryt
          </button>
          <button
            onClick={() => void create()}
            disabled={saving}
            className="h-9 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-[#141210] hover:brightness-110 disabled:opacity-60 transition"
          >
            {saving ? "Skapar…" : "Skapa bokning"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GuestSearch({
  slug,
  onPick,
}: {
  slug: string;
  onPick: (guest: GuestHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GuestHit[]>([]);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/restaurants/${slug}/guests?q=${encodeURIComponent(q.trim())}`,
      );
      const data = await res.json();
      setHits(res.ok ? data.guests : []);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mt-1">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Sök namn, e-post eller telefon…"
          className="h-9 flex-1 rounded-lg border border-[var(--w-line)] bg-[var(--w-bg)] px-3 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none"
        />
        <button
          onClick={() => void search()}
          disabled={searching}
          className="h-9 rounded-lg border border-[var(--w-line)] px-3 text-xs hover:border-[var(--w-accent)] disabled:opacity-50 transition"
        >
          {searching ? "…" : "Sök"}
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
          {hits.map((g) => (
            <li key={g.id}>
              <button
                onClick={() => onPick(g)}
                className="w-full rounded-lg border border-[var(--w-line)] px-3 py-1.5 text-left text-xs hover:border-[var(--w-accent)] transition"
              >
                <span className="font-medium">{g.name ?? "—"}</span>{" "}
                <span className="text-[var(--w-muted)]">
                  {g.email ?? ""} {g.phone ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttachGuestModal({
  slug,
  onClose,
  onAttach,
}: {
  slug: string;
  onClose: () => void;
  onAttach: (guestId: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createAndAttach() {
    if (!email.trim() && !phone.trim()) {
      setError("Ange e-post eller telefonnummer.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.guestId) {
        // Kunden fanns redan — koppla den direkt
        onAttach(data.guestId);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Kunde inte skapa kunden.");
        return;
      }
      onAttach(data.id);
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full bg-transparent border-b border-[var(--w-line)] py-2 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Koppla kund till bokningen"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-6 shadow-2xl"
      >
        <h3 className="text-xl font-semibold tracking-tight [font-family:var(--font-display),sans-serif]">
          Koppla kund
        </h3>
        <p className="mt-1 text-xs text-[var(--w-muted)]">
          Sök en befintlig kund eller registrera en ny — bokningen knyts till
          kundbilden.
        </p>

        {!creating ? (
          <>
            <div className="mt-4">
              <GuestSearch slug={slug} onPick={(g) => onAttach(g.id)} />
            </div>
            <button
              onClick={() => setCreating(true)}
              className="mt-4 h-9 w-full rounded-xl border border-dashed border-[var(--w-line)] text-sm text-[var(--w-muted)] hover:border-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
            >
              + Registrera ny kund
            </button>
          </>
        ) : (
          <div className="mt-4 space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Namn (valfritt)"
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="E-post"
                className={inputClass}
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Telefon"
                className={inputClass}
              />
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Övriga upplysningar / allergier (valfritt)"
              className={inputClass}
            />
            <p className="text-xs text-[var(--w-muted)]">
              E-post eller telefonnummer krävs.
            </p>
            {error && <p className="text-xs text-yellow-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setCreating(false)}
                className="h-9 rounded-xl border border-[var(--w-line)] px-4 text-sm text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
              >
                Tillbaka
              </button>
              <button
                onClick={() => void createAndAttach()}
                disabled={saving}
                className="h-9 rounded-xl bg-[var(--w-accent)] px-4 text-sm font-semibold text-[#141210] hover:brightness-110 disabled:opacity-60 transition"
              >
                {saving ? "Sparar…" : "Skapa & koppla"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
}

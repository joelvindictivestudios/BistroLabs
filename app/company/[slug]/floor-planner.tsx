"use client";

import { useMemo, useRef, useState } from "react";
import {
  GRID_W,
  GRID_H,
  CELL,
  FOOTPRINT,
  cellsFor,
  seatsLabel,
  toShape,
  type Shape,
} from "@/lib/floor-plan";

// Bordskartan: rum som flikar, snap-grid-canvas i SVG där bord dras på plats.
// Stolarna ritas runt varje bord (antal = kapacitet). Min–max platser styr
// allokeringen: "endast 2" = min 2/max 2. Sparas som helhet via
// PUT /api/restaurants/{slug}/floor-plan.

export type PlanRoom = { id?: string; key: string; name: string };
export type PlanTable = {
  id?: string;
  clientId: string;
  roomKey: string;
  name: string;
  capacity: number;
  minSeats: number;
  shape: Shape;
  posX: number;
  posY: number;
  bookingCount: number;
};

type Props = {
  slug: string;
  initialRooms: { id: string; name: string }[];
  initialTables: {
    id: string;
    roomId: string | null;
    name: string;
    capacity: number;
    minSeats: number;
    shape: string;
    posX: number;
    posY: number;
    bookingCount: number;
  }[];
};

// Röd släpp-yta nere till höger — syns bara medan ett bord dras
const DELETE_ZONE = {
  x: GRID_W * CELL - 158,
  y: GRID_H * CELL - 66,
  w: 148,
  h: 56,
};

const PALETTE: { label: string; shape: Shape; capacity: number }[] = [
  { label: "Runt · 2", shape: "round", capacity: 2 },
  { label: "Runt · 4", shape: "round", capacity: 4 },
  { label: "Kvadrat · 2", shape: "square", capacity: 2 },
  { label: "Rektangel · 6", shape: "rect", capacity: 6 },
];

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));


export function FloorPlanner({ slug, initialRooms, initialTables }: Props) {
  const idCounter = useRef(0);
  const nextClientId = () => `c${++idCounter.current}`;

  const [rooms, setRooms] = useState<PlanRoom[]>(() => {
    const base = initialRooms.map((r) => ({ id: r.id, key: r.id, name: r.name }));
    return base.length > 0 ? base : [{ key: "room-new-1", name: "Matsalen" }];
  });
  const [tables, setTables] = useState<PlanTable[]>(() => {
    const roomKeys = initialRooms.map((r) => r.id);
    const fallback = roomKeys[0] ?? "room-new-1";
    return initialTables.map((t) => ({
      id: t.id,
      clientId: t.id,
      roomKey: t.roomId && roomKeys.includes(t.roomId) ? t.roomId : fallback,
      name: t.name,
      capacity: t.capacity,
      minSeats: t.minSeats,
      shape: toShape(t.shape),
      posX: clamp(t.posX, 0, GRID_W - 2),
      posY: clamp(t.posY, 0, GRID_H - 2),
      bookingCount: t.bookingCount,
    }));
  });

  const [activeRoomKey, setActiveRoomKey] = useState(() => rooms[0]?.key ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingRoom, setRenamingRoom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    clientId: string;
    x: number;
    y: number;
    valid: boolean;
    overDelete: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const snapshot = (r: PlanRoom[], t: PlanTable[]) =>
    JSON.stringify({
      r: r.map(({ key, name }) => ({ key, name })),
      t: t.map((x) => ({
        id: x.id,
        roomKey: x.roomKey,
        name: x.name,
        capacity: x.capacity,
        minSeats: x.minSeats,
        shape: x.shape,
        posX: x.posX,
        posY: x.posY,
      })),
    });
  const [saved, setSaved] = useState(() => snapshot(rooms, tables));
  const dirty = snapshot(rooms, tables) !== saved;

  const roomTables = tables.filter((t) => t.roomKey === activeRoomKey);
  const selected = tables.find((t) => t.clientId === selectedId) ?? null;

  const occupiedCells = useMemo(() => {
    const map = new Map<string, string>(); // cell → clientId
    for (const t of roomTables) {
      for (const cell of cellsFor(t)) map.set(cell, t.clientId);
    }
    return map;
  }, [roomTables]);

  function isFree(
    pos: { x: number; y: number },
    shape: Shape,
    exceptId: string,
  ): boolean {
    const probe = { posX: pos.x, posY: pos.y, shape };
    return cellsFor(probe).every((cell) => {
      const owner = occupiedCells.get(cell);
      return !owner || owner === exceptId;
    });
  }

  function updateTable(clientId: string, patch: Partial<PlanTable>) {
    setTables((ts) =>
      ts.map((t) => (t.clientId === clientId ? { ...t, ...patch } : t)),
    );
  }

  // --- Lägg till bord från paletten på första lediga cell ---
  function addTable(shape: Shape, capacity: number) {
    const { w, h } = FOOTPRINT[shape];
    for (let y = 0; y <= GRID_H - h; y++) {
      for (let x = 0; x <= GRID_W - w; x++) {
        if (isFree({ x, y }, shape, "")) {
          const maxNum = tables.reduce((max, t) => {
            const m = /^T(\d+)$/.exec(t.name);
            return m ? Math.max(max, Number(m[1])) : max;
          }, 0);
          const table: PlanTable = {
            clientId: nextClientId(),
            roomKey: activeRoomKey,
            name: `T${maxNum + 1}`,
            capacity,
            minSeats: 1,
            shape,
            posX: x,
            posY: y,
            bookingCount: 0,
          };
          setTables((ts) => [...ts, table]);
          setSelectedId(table.clientId);
          return;
        }
      }
    }
    setError("Rummet är fullt — flytta något bord först.");
  }

  // --- Drag med pointer events + snap till cell ---
  function pointerToSvg(e: React.PointerEvent) {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      px: ((e.clientX - rect.left) / rect.width) * GRID_W * CELL,
      py: ((e.clientY - rect.top) / rect.height) * GRID_H * CELL,
    };
  }

  function pointerToCell(e: React.PointerEvent, shape: Shape) {
    const { px, py } = pointerToSvg(e);
    const { w, h } = FOOTPRINT[shape];
    return {
      x: clamp(Math.round(px / CELL - w / 2), 0, GRID_W - w),
      y: clamp(Math.round(py / CELL - h / 2), 0, GRID_H - h),
    };
  }

  function isOverDeleteZone(e: React.PointerEvent) {
    const { px, py } = pointerToSvg(e);
    return (
      px >= DELETE_ZONE.x &&
      px <= DELETE_ZONE.x + DELETE_ZONE.w &&
      py >= DELETE_ZONE.y &&
      py <= DELETE_ZONE.y + DELETE_ZONE.h
    );
  }

  function onTablePointerDown(e: React.PointerEvent, t: PlanTable) {
    e.preventDefault();
    setSelectedId(t.clientId);
    setError(null);
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    setDrag({
      clientId: t.clientId,
      x: t.posX,
      y: t.posY,
      valid: true,
      overDelete: false,
    });
  }

  function onTablePointerMove(e: React.PointerEvent, t: PlanTable) {
    if (!drag || drag.clientId !== t.clientId) return;
    const pos = pointerToCell(e, t.shape);
    const overDelete = isOverDeleteZone(e);
    setDrag({
      clientId: t.clientId,
      ...pos,
      valid: !overDelete && isFree(pos, t.shape, t.clientId),
      overDelete,
    });
  }

  function onTablePointerUp(t: PlanTable) {
    if (!drag || drag.clientId !== t.clientId) return;
    if (drag.overDelete) {
      if (t.bookingCount > 0) {
        setError(
          `${t.name} kan inte raderas — bordet har ${t.bookingCount} bokning(ar).`,
        );
      } else {
        removeTable(t);
      }
    } else if (drag.valid) {
      updateTable(t.clientId, { posX: drag.x, posY: drag.y });
    }
    setDrag(null);
  }

  function onTableKeyDown(e: React.KeyboardEvent, t: PlanTable) {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      const { w, h } = FOOTPRINT[t.shape];
      const pos = {
        x: clamp(t.posX + d[0], 0, GRID_W - w),
        y: clamp(t.posY + d[1], 0, GRID_H - h),
      };
      if (isFree(pos, t.shape, t.clientId)) {
        updateTable(t.clientId, { posX: pos.x, posY: pos.y });
      }
    }
  }

  function removeTable(t: PlanTable) {
    if (t.bookingCount > 0) return;
    setTables((ts) => ts.filter((x) => x.clientId !== t.clientId));
    setSelectedId(null);
  }

  // --- Rum ---
  function addRoom() {
    const key = `room-new-${nextClientId()}`;
    const name = `Rum ${rooms.length + 1}`;
    setRooms((rs) => [...rs, { key, name }]);
    setActiveRoomKey(key);
    setRenamingRoom(key);
  }

  function removeRoom(key: string) {
    if (tables.some((t) => t.roomKey === key) || rooms.length <= 1) return;
    setRooms((rs) => {
      const next = rs.filter((r) => r.key !== key);
      if (activeRoomKey === key) setActiveRoomKey(next[0].key);
      return next;
    });
  }

  // --- Spara ---
  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/restaurants/${slug}/floor-plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rooms: rooms.map((r, i) => ({
            ...(r.id ? { id: r.id } : {}),
            key: r.key,
            name: r.name,
            sortOrder: i,
          })),
          tables: tables.map((t) => ({
            ...(t.id ? { id: t.id } : {}),
            roomKey: t.roomKey,
            name: t.name,
            capacity: t.capacity,
            minSeats: t.minSeats,
            shape: t.shape,
            posX: t.posX,
            posY: t.posY,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Kunde inte spara bordskartan.");
        return;
      }
      // Skriv tillbaka server-id:n så nästa spar blir uppdateringar
      const roomIdByKey: Record<string, string> = data.roomIdByKey;
      const nextRooms = rooms.map((r) => ({ ...r, id: roomIdByKey[r.key] }));
      const nextTables = tables.map((t, i) => ({ ...t, id: data.tableIds[i] }));
      setRooms(nextRooms);
      setTables(nextTables);
      setSaved(snapshot(nextRooms, nextTables));
      setSavedAt(Date.now());
    } catch {
      setError("Något gick fel — prova igen.");
    } finally {
      setSaving(false);
    }
  }

  const labelClass =
    "text-[11px] uppercase tracking-[0.22em] text-[var(--w-muted)]";

  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className={labelClass}>Bordskarta — rum & bord</h2>
        {dirty && (
          <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-0.5 text-[10px] font-medium text-yellow-400">
            Osparad
          </span>
        )}
        {savedAt && !dirty && (
          <span className="text-[10px] text-emerald-400">Sparad ✓</span>
        )}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="ml-auto h-9 rounded-xl bg-[var(--w-accent)] px-4 text-xs font-semibold text-[#141210] hover:brightness-110 disabled:opacity-40 transition"
        >
          {saving ? "Sparar…" : "Spara bordskarta"}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--w-muted)]">
        Dra borden på plats. Klicka på ett bord för att ändra namn, form och
        platser — &quot;endast 2&quot; betyder att bordet aldrig ges till andra
        sällskapsstorlekar.
      </p>
      {error && <p className="mt-2 text-xs text-yellow-400">{error}</p>}

      {/* Rumsflikar */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {rooms.map((room) => {
          const count = tables.filter((t) => t.roomKey === room.key).length;
          const active = room.key === activeRoomKey;
          return (
            <div key={room.key} className="flex items-center">
              {renamingRoom === room.key ? (
                <input
                  autoFocus
                  defaultValue={room.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim() || room.name;
                    setRooms((rs) =>
                      rs.map((r) => (r.key === room.key ? { ...r, name } : r)),
                    );
                    setRenamingRoom(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-9 w-32 rounded-lg border border-[var(--w-accent)] bg-[var(--w-panel)] px-3 text-sm focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => setActiveRoomKey(room.key)}
                  onDoubleClick={() => setRenamingRoom(room.key)}
                  title="Dubbelklicka för att byta namn"
                  className={`h-9 rounded-lg border px-3 text-sm transition-colors ${
                    active
                      ? "border-[var(--w-accent)] bg-[var(--w-accent)]/10 text-[var(--w-accent)]"
                      : "border-[var(--w-line)] bg-[var(--w-panel)] text-[var(--w-muted)] hover:text-[var(--w-ink)]"
                  }`}
                >
                  {room.name}
                  <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
                </button>
              )}
              {active &&
                count === 0 &&
                rooms.length > 1 &&
                renamingRoom !== room.key && (
                  <button
                    onClick={() => removeRoom(room.key)}
                    aria-label={`Ta bort ${room.name}`}
                    className="ml-1 text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)]"
                  >
                    ✕
                  </button>
                )}
            </div>
          );
        })}
        <button
          onClick={addRoom}
          className="h-9 rounded-lg border border-dashed border-[var(--w-line)] px-3 text-sm text-[var(--w-muted)] hover:border-[var(--w-muted)] hover:text-[var(--w-ink)] transition"
        >
          + Nytt rum
        </button>
      </div>

      {/* Palett */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PALETTE.map((p) => (
          <button
            key={p.label}
            onClick={() => addTable(p.shape, p.capacity)}
            className="h-8 rounded-lg border border-[var(--w-line)] bg-[var(--w-panel)] px-3 text-xs text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] transition"
          >
            + {p.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div className="mt-3 overflow-x-auto rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${GRID_W * CELL} ${GRID_H * CELL}`}
          className="h-auto w-full touch-none select-none"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          <defs>
            <pattern id="fp-dots" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
              <circle cx={CELL / 2} cy={CELL / 2} r={1.3} fill="var(--w-line)" />
            </pattern>
          </defs>
          <rect
            width={GRID_W * CELL}
            height={GRID_H * CELL}
            fill="url(#fp-dots)"
            onPointerDown={() => setSelectedId(null)}
          />
          {drag && (
            <g style={{ pointerEvents: "none" }}>
              <rect
                x={DELETE_ZONE.x}
                y={DELETE_ZONE.y}
                width={DELETE_ZONE.w}
                height={DELETE_ZONE.h}
                rx={12}
                fill={
                  drag.overDelete
                    ? "rgba(248,113,113,0.28)"
                    : "rgba(248,113,113,0.08)"
                }
                stroke="#f87171"
                strokeWidth={drag.overDelete ? 2 : 1.2}
                strokeDasharray={drag.overDelete ? undefined : "6 4"}
              />
              <text
                x={DELETE_ZONE.x + DELETE_ZONE.w / 2}
                y={DELETE_ZONE.y + DELETE_ZONE.h / 2 - 4}
                textAnchor="middle"
                fontSize={16}
                fill="#f87171"
              ></text>
              <text
                x={DELETE_ZONE.x + DELETE_ZONE.w / 2}
                y={DELETE_ZONE.y + DELETE_ZONE.h / 2 + 16}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="#f87171"
              >
                {drag.overDelete ? "Släpp för att radera" : "Dra hit för att radera"}
              </text>
            </g>
          )}
          {roomTables.map((t) => (
            <TableGlyph
              key={t.clientId}
              table={t}
              dragPos={
                drag?.clientId === t.clientId
                  ? { x: drag.x, y: drag.y, valid: drag.valid }
                  : null
              }
              selected={selectedId === t.clientId}
              onPointerDown={(e) => onTablePointerDown(e, t)}
              onPointerMove={(e) => onTablePointerMove(e, t)}
              onPointerUp={() => onTablePointerUp(t)}
              onKeyDown={(e) => onTableKeyDown(e, t)}
            />
          ))}
        </svg>
      </div>

      {/* Sammanfattning */}
      <p className="mt-2 text-xs text-[var(--w-muted)]">
        {rooms.find((r) => r.key === activeRoomKey)?.name}: {roomTables.length}{" "}
        bord · {roomTables.reduce((s, t) => s + t.capacity, 0)} platser
        <span className="mx-2 opacity-50">·</span>
        Totalt: {tables.length} bord ·{" "}
        {tables.reduce((s, t) => s + t.capacity, 0)} platser
      </p>

      {/* Egenskapspanel för valt bord */}
      {selected && (
        <div className="mt-4 rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] p-5">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
            <label className="text-sm w-40">
              <span className="text-xs text-[var(--w-muted)]">Namn</span>
              <input
                value={selected.name}
                onChange={(e) =>
                  updateTable(selected.clientId, { name: e.target.value })
                }
                className="w-full bg-transparent border-b border-[var(--w-line)] py-1.5 text-sm focus:border-[var(--w-accent)] focus:outline-none"
              />
            </label>
            <div className="text-sm">
              <span className="text-xs text-[var(--w-muted)]">Form</span>
              <div className="mt-1.5 flex gap-1">
                {(
                  [
                    ["round", "Runt"],
                    ["square", "Kvadrat"],
                    ["rect", "Rektangel"],
                  ] as const
                ).map(([shape, label]) => (
                  <button
                    key={shape}
                    onClick={() => {
                      // Byt bara form om nya footprinten får plats
                      if (isFree({ x: selected.posX, y: selected.posY }, shape, selected.clientId)) {
                        const { w, h } = FOOTPRINT[shape];
                        updateTable(selected.clientId, {
                          shape,
                          posX: clamp(selected.posX, 0, GRID_W - w),
                          posY: clamp(selected.posY, 0, GRID_H - h),
                        });
                      }
                    }}
                    aria-pressed={selected.shape === shape}
                    className={`h-8 rounded-lg border px-2.5 text-xs transition ${
                      selected.shape === shape
                        ? "border-[var(--w-accent)] text-[var(--w-accent)]"
                        : "border-[var(--w-line)] text-[var(--w-muted)] hover:text-[var(--w-ink)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Stepper
              label="Platser (max)"
              value={selected.capacity}
              min={selected.minSeats}
              max={20}
              onChange={(v) => updateTable(selected.clientId, { capacity: v })}
            />
            <Stepper
              label="Minsta sällskap"
              value={selected.minSeats}
              min={1}
              max={selected.capacity}
              onChange={(v) => updateTable(selected.clientId, { minSeats: v })}
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() =>
                updateTable(selected.clientId, { minSeats: selected.capacity })
              }
              className="h-8 rounded-lg border border-[var(--w-line)] px-3 text-xs text-[var(--w-muted)] hover:border-[var(--w-accent)] hover:text-[var(--w-ink)] transition"
            >
              Endast exakt antal ({selected.capacity})
            </button>
            <span className="text-xs text-[var(--w-muted)]">
              Tar sällskap om {seatsLabel(selected)}
            </span>
            <button
              onClick={() => removeTable(selected)}
              disabled={selected.bookingCount > 0}
              title={
                selected.bookingCount > 0
                  ? `Kan inte raderas — bordet har ${selected.bookingCount} bokning(ar)`
                  : undefined
              }
              className="ml-auto h-8 rounded-lg border border-red-500/40 px-3 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Ta bort bord
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="text-sm">
      <span className="text-xs text-[var(--w-muted)]">{label}</span>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => onChange(clamp(value - 1, min, max))}
          disabled={value <= min}
          aria-label={`Minska ${label}`}
          className="h-8 w-8 rounded-lg border border-[var(--w-line)] text-sm disabled:opacity-30"
        >
          −
        </button>
        <span className="w-6 text-center font-mono">{value}</span>
        <button
          onClick={() => onChange(clamp(value + 1, min, max))}
          disabled={value >= max}
          aria-label={`Öka ${label}`}
          className="h-8 w-8 rounded-lg border border-[var(--w-line)] text-sm disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

function TableGlyph({
  table,
  dragPos,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  table: PlanTable;
  dragPos: { x: number; y: number; valid: boolean } | null;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const { w: fw, h: fh } = FOOTPRINT[table.shape];
  const pos = dragPos ?? { x: table.posX, y: table.posY, valid: true };
  const x = pos.x * CELL;
  const y = pos.y * CELL;
  const w = fw * CELL;
  const h = fh * CELL;
  const cx = w / 2;
  const cy = h / 2;

  const stroke = !pos.valid
    ? "#f87171"
    : selected
      ? "var(--w-accent)"
      : "var(--w-line)";
  const bodyFill = "#1e1e1e";

  // Stolar jämnt fördelade runt bordet
  const chairs = Array.from({ length: table.capacity }, (_, i) => {
    const angle = (i / table.capacity) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * (w / 2 - 7),
      y: cy + Math.sin(angle) * (h / 2 - 7),
    };
  });

  const inset = 15; // luft mellan stolar och bordsskiva
  return (
    <g
      transform={`translate(${x}, ${y})`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`Bord ${table.name}, ${seatsLabel(table)} platser`}
      style={{ cursor: dragPos ? "grabbing" : "grab", outline: "none" }}
      opacity={dragPos ? 0.85 : 1}
    >
      {chairs.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={4.5} fill="#2e2e2e" stroke={stroke} strokeWidth={1} />
      ))}
      {table.shape === "round" ? (
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(w, h) / 2 - inset}
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={selected ? 2 : 1.2}
        />
      ) : (
        <rect
          x={inset}
          y={inset}
          width={w - inset * 2}
          height={h - inset * 2}
          rx={10}
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={selected ? 2 : 1.2}
        />
      )}
      <text
        x={cx}
        y={cy - 3}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill="var(--w-ink)"
        style={{ pointerEvents: "none" }}
      >
        {table.name}
      </text>
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        fontSize={8.5}
        fill="var(--w-muted)"
        style={{ pointerEvents: "none" }}
      >
        {seatsLabel(table)}
      </text>
    </g>
  );
}

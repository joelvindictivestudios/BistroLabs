// Delade konstanter för bordskartan — används av redigeraren
// (app/company/[slug]/floor-planner.tsx) och den operativa dagvyn
// (app/bookings/[slug]/bookings-client.tsx).

export type Shape = "round" | "square" | "rect";

export const GRID_W = 16;
export const GRID_H = 10;
export const CELL = 44;

export const FOOTPRINT: Record<Shape, { w: number; h: number }> = {
  round: { w: 2, h: 2 },
  square: { w: 2, h: 2 },
  rect: { w: 3, h: 2 },
};

export function toShape(value: string): Shape {
  return value === "square" || value === "rect" ? value : "round";
}

export function cellsFor(t: {
  posX: number;
  posY: number;
  shape: Shape;
}): string[] {
  const { w, h } = FOOTPRINT[t.shape];
  const cells: string[] = [];
  for (let dx = 0; dx < w; dx++)
    for (let dy = 0; dy < h; dy++) cells.push(`${t.posX + dx},${t.posY + dy}`);
  return cells;
}

export function seatsLabel(t: { minSeats: number; capacity: number }): string {
  return t.minSeats === t.capacity
    ? `exakt ${t.capacity}`
    : t.minSeats > 1
      ? `${t.minSeats}–${t.capacity}`
      : `1–${t.capacity}`;
}

/** Stolspositioner jämnt fördelade runt ett bords footprint (i pixlar). */
export function chairPositions(
  capacity: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  const cx = w / 2;
  const cy = h / 2;
  return Array.from({ length: capacity }, (_, i) => {
    const angle = (i / capacity) * Math.PI * 2 - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * (w / 2 - 7),
      y: cy + Math.sin(angle) * (h / 2 - 7),
    };
  });
}

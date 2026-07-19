import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { findOrCreateGuest } from "@/lib/booking/guests";

// POST /api/restaurants/{slug}/guests/import — CSV-import av gästregister
// (migrering från TheFork/Bokabord/Excel). Kolumner: namn, e-post, telefon,
// anteckning (svenska eller engelska rubriker, valfri ordning). Dubbletter
// (samma e-post/telefon) slås samman via findOrCreateGuest — tomma fält
// kompletteras, befintliga skrivs aldrig över.

const MAX_BYTES = 1024 * 1024; // 1 MB
const MAX_ROWS = 1000;

const HEADER_ALIASES: Record<string, "name" | "email" | "phone" | "notes"> = {
  name: "name",
  namn: "name",
  email: "email",
  "e-post": "email",
  epost: "email",
  mejl: "email",
  mail: "email",
  phone: "phone",
  telefon: "phone",
  tel: "phone",
  mobil: "phone",
  note: "notes",
  notes: "notes",
  anteckning: "notes",
  anteckningar: "notes",
};

/** RFC 4180-ish: citerade fält med ""-escape, inbäddade avgränsare/radbryt. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function decodeBody(buf: ArrayBuffer): string {
  let bytes = new Uint8Array(buf);
  // Strippa UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Äldre Excel-exporter: å/ä/ö i windows-1252
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/restaurants/[slug]/guests/import">,
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

  // multipart (fältet "file") eller rå text/csv
  let raw: ArrayBuffer;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Bifoga en CSV-fil i fältet \"file\"." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Filen är för stor (max 1 MB)." },
        { status: 400 },
      );
    }
    raw = await file.arrayBuffer();
  } else {
    raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "Filen är för stor (max 1 MB)." },
        { status: 400 },
      );
    }
  }
  if (raw.byteLength === 0) {
    return NextResponse.json({ error: "Tom fil." }, { status: 400 });
  }

  const text = decodeBody(raw);
  // Avgränsar-sniff på rubrikraden: svensk Excel exporterar med semikolon
  const headerLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const rows = parseCsv(text, delimiter);
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "CSV:n behöver en rubrikrad och minst en datarad." },
      { status: 400 },
    );
  }
  if (rows.length - 1 > MAX_ROWS) {
    return NextResponse.json(
      { error: `Max ${MAX_ROWS} rader per import.` },
      { status: 400 },
    );
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const columns = header.map((h) => HEADER_ALIASES[h] ?? null);
  if (!columns.includes("email") && !columns.includes("phone")) {
    return NextResponse.json(
      { error: "CSV:n behöver en kolumn för e-post eller telefon." },
      { status: 400 },
    );
  }

  let created = 0;
  let merged = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const data: { name?: string; email?: string; phone?: string; notes?: string } =
      {};
    rows[i].forEach((cell, col) => {
      const key = columns[col];
      const value = cell.trim();
      if (key && value) data[key] = value;
    });

    if (!data.email && !data.phone) {
      skipped++;
      if (errors.length < 10)
        errors.push({ row: i + 1, message: "Saknar e-post och telefon" });
      continue;
    }
    if (data.email && !EMAIL_RE.test(data.email)) {
      skipped++;
      if (errors.length < 10)
        errors.push({ row: i + 1, message: `Ogiltig e-post: ${data.email}` });
      continue;
    }

    const { created: isNew } = await findOrCreateGuest(restaurant.id, data);
    if (isNew) created++;
    else merged++;
  }

  return NextResponse.json({ created, merged, skipped, errors });
}

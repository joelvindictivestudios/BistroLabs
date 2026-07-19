// Initialavatar (DESIGN-SYSTEM §2.5): deterministisk hash av namnet väljer
// färg ur en fast palett; initialer = första + sista namnets första bokstav.

const PALETTE = [
  "#c0673f",
  "#4a6fa5",
  "#5f8a6a",
  "#9a6a8c",
  "#b08534",
  "#5b7a8c",
] as const;

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  size = 40,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        backgroundColor: avatarColor(name || "Gäst"),
      }}
    >
      {initials(name || "Gäst")}
    </span>
  );
}

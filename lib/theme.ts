import type { RestaurantConfig } from "./email-concierge/types";

export type AdminTheme = RestaurantConfig["theme"];

// SideRays-ljuseffekten på dashboarden per tema. Ljust tema hoppar över
// WebGL-strålarna (läser dåligt mot ljus botten) och får en statisk glöd.
const SIDE_RAYS: Record<
  AdminTheme,
  { rayColor1: string; rayColor2: string; opacity: number } | null
> = {
  classic: { rayColor1: "#c89b5a", rayColor2: "#96c8ff", opacity: 0.5 },
  warm: { rayColor1: "#c0673f", rayColor2: "#f0c896", opacity: 0.45 },
  light: null,
};

export function adminTheme(config: RestaurantConfig): {
  dataTheme: AdminTheme;
  sideRays: { rayColor1: string; rayColor2: string; opacity: number } | null;
} {
  return { dataTheme: config.theme, sideRays: SIDE_RAYS[config.theme] };
}

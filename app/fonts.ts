import { Fraunces, Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";

// Temafonterna laddas en gång i rot-layouten och exponeras som variabler.
// Alla adminteman kör Jakarta (display) + Arial (UI); widgeten kör Fraunces.
// Vilken som används styrs i app/tokens.css (--font-display-theme m.fl.).

export const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "600", "700"],
});

export const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600"],
});

export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const fontVariables = `${jakarta.variable} ${fraunces.variable} ${geistMono.variable}`;

// Absolut bas-URL för länkar i utskick (hanteringslänken, ombokningslänken).
// Samma mönster som phone-number-routen: NEXT_PUBLIC_APP_URL i produktion,
// annars anropets origin (funkar i både dev och deploy), sist localhost
// (cron-jobb utan request-origin i ren dev-miljö).
export function appBaseUrl(requestOrigin?: string): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? requestOrigin ?? "http://localhost:3000"
  );
}

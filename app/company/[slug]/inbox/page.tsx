import { InboxClient } from "./inbox-client";

export const metadata = { title: "AI-inkorg — BistroLabs" };

// AI-inkorgen: gästmejl där AI:n skrivit utkast som väntar på granskning.
// All data hämtas klientside från /api/restaurants/{slug}/inbox (samma källa
// som sidofältets badge) så vyn kan refetcha efter varje åtgärd.
export default async function InboxPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <InboxClient slug={slug} />;
}

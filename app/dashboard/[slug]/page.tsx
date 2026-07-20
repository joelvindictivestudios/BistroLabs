import { redirect } from "next/navigation";

// Översikten bor numera i adminpanelens skal (/company/[slug]) — den här
// routen finns kvar som redirect eftersom inloggning, "‹ Översikt"-länkar
// och gamla bokmärken pekar hit.
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/company/${slug}`);
}

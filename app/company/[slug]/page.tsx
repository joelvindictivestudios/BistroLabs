import { redirect } from "next/navigation";

// Adminpanelens rot — bordskartan är startsidan.
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/company/${slug}/floor`);
}

import { AdminShell } from "@/app/components/admin-shell";

export const metadata = { title: "Din Restaurang — BistroLabs" };

// Adminpanelens skal bor i AdminShell (delas med bokningsvyn). Undersidorna
// (översikt/floor/hours/customers/settings/inbox/rapporter) renderas som
// children och gör sina egna datainläsningar.
export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <AdminShell slug={slug}>{children}</AdminShell>;
}

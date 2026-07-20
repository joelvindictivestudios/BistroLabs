import { AdminShell } from "@/app/components/admin-shell";

// Bokningsvyn får samma skal (toppbar + sidomeny) som resten av adminen,
// men opaddad yta — dagvyn hanterar sin egen layout (karta + lista).
export default async function BookingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <AdminShell slug={slug} padded={false}>{children}</AdminShell>;
}

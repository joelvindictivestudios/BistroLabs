import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getUser } from "@/lib/auth/server";
import { CreateRestaurantForm } from "./create-restaurant-form";

export const metadata = { title: "Skapa din restaurang — BistroLabs" };

export default async function CreateRestaurantPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // Äger man redan en restaurang är hubben hemskärmen
  const existing = await prisma.restaurant.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  if (existing) redirect(`/dashboard/${existing.slug}`);

  const meta = (user.user_metadata ?? {}) as {
    name?: string;
    restaurant_name?: string;
  };

  return (
    <div data-theme="warm">
      <CreateRestaurantForm
        userEmail={user.email ?? ""}
        defaultRestaurantName={meta.restaurant_name ?? ""}
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/server";
import { AuthForm } from "./auth-form";

export const metadata = { title: "Logga in — BistroLabs" };

// Auth-sidorna bär varumärkeslooken (GPG varm) — de föregår varje
// restaurang och därmed varje temaval.
export default async function LoginPage() {
  if (await getUser()) redirect("/create-restaurant");

  return (
    <div data-theme="warm">
      <AuthForm />
    </div>
  );
}

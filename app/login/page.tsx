import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getUser } from "@/lib/auth/server";
import { AuthForm } from "./auth-form";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "700"],
});

export const metadata = { title: "Logga in — BistroLabs" };

export default async function LoginPage() {
  if (await getUser()) redirect("/create-restaurant");

  return (
    <div className={jakarta.variable}>
      <AuthForm />
    </div>
  );
}

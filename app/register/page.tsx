import { Fraunces } from "next/font/google";
import { RegisterForm } from "./register-form";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
});

export const metadata = { title: "Registrera din restaurang — BistroLabs" };

export default function RegisterPage() {
  return (
    <div className={fraunces.variable}>
      <RegisterForm />
    </div>
  );
}

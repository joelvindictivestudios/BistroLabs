import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminSupabase } from "@/lib/auth/server";

const signupSchema = z
  .object({
    restaurantName: z.string().min(2).max(80),
    name: z.string().min(1).max(80),
    email: z.email(),
    password: z.string().min(8).max(72),
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Lösenorden matchar inte",
    path: ["passwordConfirm"],
  });

// Skapar kontot via admin-API:t med email_confirm: true —
// ingen bekräftelsemejl krävs, användaren kan logga in direkt.
export async function POST(request: NextRequest) {
  const parsed = signupSchema.safeParse(await request.json());
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const { restaurantName, name, email, password } = parsed.data;

  const admin = getAdminSupabase();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, restaurant_name: restaurantName },
  });

  if (error) {
    const taken =
      error.code === "email_exists" || /already/i.test(error.message);
    return NextResponse.json(
      {
        error: taken
          ? "Det finns redan ett konto med den e-postadressen — logga in istället."
          : `Kontot kunde inte skapas: ${error.message}`,
      },
      { status: taken ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

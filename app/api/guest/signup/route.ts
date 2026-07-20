import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminSupabase } from "@/lib/auth/server";

// Matgäst-konton (§3.1 uppgiftssteget): frivilligt konto för gäster som vill
// spara sina uppgifter till nästa besök. Spegel av personal-signupen
// (app/api/auth/signup) men med user_metadata.kind = "guest" — matgäster och
// restaurangägare skiljs åt på data, inte på separata auth-system.

const signupSchema = z
  .object({
    name: z.string().min(1).max(120),
    phone: z.string().min(5).max(30).optional(),
    email: z.email(),
    password: z.string().min(8).max(72),
  })
  .strict();

// Skapar kontot via admin-API:t med email_confirm: true —
// ingen bekräftelsemejl krävs, gästen kan logga in direkt.
export async function POST(request: NextRequest) {
  const parsed = signupSchema.safeParse(await request.json());
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Ogiltiga uppgifter" },
      { status: 400 },
    );
  }
  const { name, phone, email, password } = parsed.data;

  const admin = getAdminSupabase();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone: phone ?? "", kind: "guest" },
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

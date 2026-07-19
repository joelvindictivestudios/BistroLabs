// Utskickslager för transaktionsmejl (bekräftelse, påminnelse, AI-inkorgens
// godkända svar). Med RESEND_API_KEY satt skickas riktiga mejl via Resend;
// utan nyckel loggas utskicket bara (dev-stub) så alla flöden går att köra
// lokalt. Kastar aldrig — anroparen avgör om ett misslyckat utskick spelar roll.

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[dev-mejl] till=${input.to} ämne="${input.subject}"\n${input.text}`,
    );
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "BistroLabs <onboarding@resend.dev>",
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Resend-fel ${res.status}: ${body}`);
      return { ok: false, error: `Resend svarade ${res.status}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    console.error("Mejlutskick misslyckades:", e);
    return { ok: false, error: "Mejlutskicket misslyckades" };
  }
}

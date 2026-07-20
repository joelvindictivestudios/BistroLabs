// SMS via Twilio Messages API — spegel av sendEmail-mönstret i send.ts:
// utan credentials loggas utskicket bara (dev-stub), och funktionen kastar
// aldrig. Avsändarnummer per restaurang (config.voiceAgent.phoneNumber),
// med TWILIO_SMS_FROM som fallback.
//
// OBS: lib/twilio.ts:s credentials() THROWAR vid saknade env — den används
// medvetet inte här; auth byggs inline så stubben fungerar.

export type SendSmsInput = { to: string; text: string; from?: string };
export type SendSmsResult =
  | { ok: true; sid?: string }
  | { ok: false; error: string };

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const keySid = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !keySid || !keySecret) {
    console.log(`[dev-sms] till=${input.to} text="${input.text}"`);
    return { ok: true };
  }

  const from = input.from || process.env.TWILIO_SMS_FROM;
  if (!from) {
    console.error("[sms] avsändarnummer saknas (TWILIO_SMS_FROM)");
    return { ok: false, error: "Avsändarnummer saknas." };
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${keySid}:${keySecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: input.to,
          From: from,
          Body: input.text,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`[sms] Twilio ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, error: `Twilio svarade ${res.status}` };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error("[sms] nätverksfel:", e);
    return { ok: false, error: "Nätverksfel mot Twilio." };
  }
}

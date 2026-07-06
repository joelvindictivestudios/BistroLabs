// Minimal Twilio REST-klient (ren fetch, ingen SDK) — nummerköp för
// Bokningsassistenten. Auth: API Key SID + Secret som Basic auth.

const TWILIO_API = "https://api.twilio.com/2010-04-01";

function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const keySid = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;
  if (!accountSid || !keySid || !keySecret) {
    throw new Error("Twilio-nycklar saknas i .env (TWILIO_*)");
  }
  return {
    accountSid,
    authHeader: `Basic ${Buffer.from(`${keySid}:${keySecret}`).toString("base64")}`,
  };
}

export type AvailableNumber = { phoneNumber: string; friendlyName: string };

/** Sök ett ledigt röst-kapabelt nummer. Frågar först Twilio vilka nummertyper
 *  landet har (SE har t.ex. bara Mobile — och de är röstlösa tills en
 *  regulatorisk bundle registrerats på kontot). Tom lista = inget köpbart. */
export async function searchAvailableNumbers(
  countryCode = "SE",
  limit = 5,
): Promise<AvailableNumber[]> {
  const { accountSid, authHeader } = credentials();

  const countryRes = await fetch(
    `${TWILIO_API}/Accounts/${accountSid}/AvailablePhoneNumbers/${countryCode}.json`,
    { headers: { Authorization: authHeader } },
  );
  const countryData = await countryRes.json();
  if (!countryRes.ok) {
    throw new Error(
      countryData?.message ?? `Twilio-sökning misslyckades (${countryRes.status})`,
    );
  }
  const typeUris: string[] = Object.values(countryData.subresource_uris ?? {});

  for (const uri of typeUris) {
    const res = await fetch(
      `https://api.twilio.com${uri}?VoiceEnabled=true&PageSize=${limit}`,
      { headers: { Authorization: authHeader } },
    );
    if (!res.ok) continue;
    const data = await res.json();
    const numbers = (data.available_phone_numbers ?? []).map(
      (n: { phone_number: string; friendly_name: string }) => ({
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name,
      }),
    );
    if (numbers.length > 0) return numbers;
  }
  return [];
}

export type PurchasedNumber = { phoneNumber: string; sid: string };

/** Köp ett nummer och peka inkommande samtal mot vår voice-webhook. */
export async function purchaseNumber(
  phoneNumber: string,
  voiceUrl: string,
): Promise<PurchasedNumber> {
  const { accountSid, authHeader } = credentials();
  const res = await fetch(
    `${TWILIO_API}/Accounts/${accountSid}/IncomingPhoneNumbers.json`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        PhoneNumber: phoneNumber,
        VoiceUrl: voiceUrl,
        VoiceMethod: "POST",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message ?? `Twilio-köp misslyckades (${res.status})`);
  }
  return { phoneNumber: data.phone_number, sid: data.sid };
}

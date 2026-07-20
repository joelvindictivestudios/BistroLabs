"use client";

// Kortfälten för kortgarantin — delas av widgetens kortsteg och
// hanteringssidans "Ange kort och bekräfta" (§3.1). Värdena lever endast i
// anroparens state → POST → glöms; inget kortformat persisteras eller loggas.

export type CardValue = { number: string; exp: string; cvc: string };

export function cardDigits(value: CardValue): string {
  return value.number.replace(/\D/g, "");
}

/** Knappen aktiveras vid minst 12 siffror (POC-regeln, §3.1). */
export function cardReady(value: CardValue): boolean {
  return cardDigits(value).length >= 12;
}

/** "MM/ÅÅ" → { expMonth, expYear } för API-anropet. */
export function parseExpiry(exp: string): {
  expMonth: number;
  expYear: number;
} {
  const m = exp.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return { expMonth: 0, expYear: 0 };
  return { expMonth: Number(m[1]), expYear: Number(m[2]) };
}

const inputClass =
  "w-full bg-transparent border-b border-[var(--w-line)] py-2.5 text-sm placeholder:text-[var(--w-muted)]/60 focus:border-[var(--w-accent)] focus:outline-none";

export function CardFields({
  value,
  onChange,
  disabled,
}: {
  value: CardValue;
  onChange: (next: CardValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs text-[var(--w-muted)]">Kortnummer</span>
        <input
          value={value.number}
          onChange={(e) => onChange({ ...value, number: e.target.value })}
          placeholder="1234 5678 9012 3456"
          inputMode="numeric"
          autoComplete="cc-number"
          disabled={disabled}
          className={`${inputClass} tracking-wider`}
        />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-[var(--w-muted)]">Giltigt t.o.m.</span>
          <input
            value={value.exp}
            onChange={(e) => onChange({ ...value, exp: e.target.value })}
            placeholder="MM/ÅÅ"
            inputMode="numeric"
            autoComplete="cc-exp"
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--w-muted)]">CVC</span>
          <input
            value={value.cvc}
            onChange={(e) => onChange({ ...value, cvc: e.target.value })}
            placeholder="123"
            inputMode="numeric"
            autoComplete="cc-csc"
            disabled={disabled}
            className={inputClass}
          />
        </label>
      </div>
    </div>
  );
}

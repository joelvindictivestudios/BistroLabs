import Image from "next/image";

// Egen 404 för widget-adresser: okänd slug eller avpublicerad restaurang.
export default function WidgetNotFound() {
  return (
    <div
      data-theme="widget-classic"
      className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-[#050505] px-6 text-center"
    >
      <Image
        src="/BLWhiteSide.png"
        alt="BistroLabs"
        width={138}
        height={30}
        className="h-7 w-auto opacity-80"
      />
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#999999]">
          404
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#ede7dc] [font-family:var(--font-display),sans-serif]">
          Den här bokningssidan finns inte
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#999999]">
          Adressen är fel, eller så har restaurangen inte öppnat sin bokning
          ännu. Dubbelkolla länken du fick, eller titta förbi lite senare.
        </p>
      </div>
    </div>
  );
}

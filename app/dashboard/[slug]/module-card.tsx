"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaLock, FaInfoCircle } from "react-icons/fa";

export type ModuleCardProps = {
  href: string;
  title: string;
  icon?: string;
  /** Alternativ till bildikon — t.ex. en Hugeicons-komponent från servern */
  iconNode?: React.ReactNode;
  description: string;
  locked?: boolean;
  /** Väntande-räknare (AI-inkorgen) — accentpill uppe till höger */
  badge?: number;
};

const cardClasses =
  "group relative flex h-52 items-center justify-center rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] transition-colors motion-safe:duration-150";

export function ModuleCard({
  href,
  title,
  icon,
  description,
  iconNode,
  badge,
  locked = false,
}: ModuleCardProps) {
  const [wiggling, setWiggling] = useState(false);

  const content = (
    <>
      {icon ? (
        <Image
          src={icon}
          alt=""
          width={112}
          height={112}
          // icon-on-dark: inverteras till mörk i ljust tema (tokens.css)
          className={`icon-on-dark h-14 w-14 object-contain transition-opacity motion-safe:duration-200 ${
            locked ? "opacity-40" : "group-hover:opacity-40"
          }`}
        />
      ) : (
        <span
          className={`flex h-14 w-14 items-center justify-center transition-opacity motion-safe:duration-200 ${
            locked ? "opacity-40" : "group-hover:opacity-40"
          }`}
        >
          {iconNode}
        </span>
      )}
      {badge !== undefined && badge > 0 && (
        <span className="absolute left-4 top-4 rounded-pill bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-on">
          {badge}
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-4 bottom-5 text-center text-sm font-medium text-ink-secondary opacity-0 transition-opacity motion-safe:duration-200 group-hover:opacity-100">
        {title}
      </span>
      <span className="group/info absolute right-4 top-4 z-10 opacity-0 transition-opacity motion-safe:duration-200 group-hover:opacity-100">
        <FaInfoCircle className="h-4 w-4 text-[var(--w-muted)] transition-colors hover:text-white/80" />
        <span className="pointer-events-none absolute right-0 top-6 block w-56 rounded-lg bg-black bg-[var(--w-panel)] p-3 text-left text-xs leading-relaxed text-ink-secondary opacity-0 shadow-lg transition-opacity motion-safe:duration-200 group-hover/info:opacity-100">
          {description}
        </span>
      </span>
    </>
  );

  if (locked) {
    return (
      <button
        type="button"
        aria-disabled="true"
        onClick={() => setWiggling(true)}
        className={`${cardClasses} cursor-not-allowed`}
      >
        <FaLock
          onAnimationEnd={() => setWiggling(false)}
          className={`absolute left-4 top-4 h-4 w-4 text-[var(--w-muted)] ${
            wiggling ? "animate-wiggle" : ""
          }`}
        />
        {content}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className={`${cardClasses} hover:border-[var(--w-accent)]`}
    >
      {content}
    </Link>
  );
}

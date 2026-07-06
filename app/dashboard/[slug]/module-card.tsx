"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaLock, FaInfoCircle } from "react-icons/fa";

export type ModuleCardProps = {
  href: string;
  title: string;
  icon: string;
  description: string;
  locked?: boolean;
};

const cardClasses =
  "group relative flex h-52 items-center justify-center rounded-2xl border border-[var(--w-line)] bg-[var(--w-panel)] transition-colors motion-safe:duration-150";

export function ModuleCard({
  href,
  title,
  icon,
  description,
  locked = false,
}: ModuleCardProps) {
  const [wiggling, setWiggling] = useState(false);

  const content = (
    <>
      <Image
        src={icon}
        alt=""
        width={112}
        height={112}
        className={`h-14 w-14 object-contain transition-opacity motion-safe:duration-200 ${
          locked ? "opacity-40" : "group-hover:opacity-40"
        }`}
      />
      <span className="pointer-events-none absolute inset-x-4 bottom-5 text-center text-sm font-medium text-white/75 opacity-0 transition-opacity motion-safe:duration-200 group-hover:opacity-100">
        {title}
      </span>
      <span className="group/info absolute right-4 top-4 z-10 opacity-0 transition-opacity motion-safe:duration-200 group-hover:opacity-100">
        <FaInfoCircle className="h-4 w-4 text-[var(--w-muted)] transition-colors hover:text-white/80" />
        <span className="pointer-events-none absolute right-0 top-6 block w-56 rounded-lg bg-black bg-[var(--w-panel)] p-3 text-left text-xs leading-relaxed text-white/75 opacity-0 shadow-lg transition-opacity motion-safe:duration-200 group-hover/info:opacity-100">
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

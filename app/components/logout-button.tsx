"use client";

import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/auth/client";

export function LogoutButton({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await getBrowserSupabase().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="text-xs text-[var(--w-muted)] hover:text-[var(--w-ink)] transition-colors"
      title={userEmail}
    >
      Logga ut
    </button>
  );
}

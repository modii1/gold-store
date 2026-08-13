"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User } from "lucide-react";

export function AccountLink({ className }: { className?: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => { if (active && d.loggedIn) setName(d.name); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <Link href="/account" className={className} aria-label="حسابي" title={name || "حسابي"}>
      {name ? (
        <span className="flex items-center gap-1.5 text-xs font-bold text-gold-dark">
          <User className="h-6 w-6" />
          <span className="hidden xl:inline max-w-24 truncate">{name.split(" ")[0]}</span>
        </span>
      ) : (
        <User className="h-6 w-6" />
      )}
    </Link>
  );
}

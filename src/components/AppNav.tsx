"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: [string, string][] = [
  ["/", "Check a brand"],
  ["/settings", "Settings"],
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={pathname === href ? "active" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

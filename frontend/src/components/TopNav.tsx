"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/search_form", label: "New Search" },
  { href: "/searches", label: "Searches" },
  { href: "/runs", label: "Runs" },
  { href: "/resources", label: "Resources" },
  { href: "/domains", label: "Domains" },
  { href: "/reactions_view", label: "Reactions" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-background">
      <div className="container max-w-5xl mx-auto px-4 flex items-center gap-1 h-12">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors hover:bg-muted ${
              pathname === href || pathname.startsWith(href + "?")
                ? "bg-muted text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

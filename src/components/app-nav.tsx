"use client";

import clsx from "clsx";
import { ClipboardList, Ship, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./session/session-provider";

const LINKS = [
  { href: "/", label: "Work orders", icon: ClipboardList, adminOnly: false },
  { href: "/admin/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/admin/vessels", label: "Vessels", icon: Ship, adminOnly: true },
];

export function AppNav() {
  const pathname = usePathname();
  const { member } = useSession();
  const isAdmin = member?.role === "Admin";
  const links = LINKS.filter((link) => !link.adminOnly || isAdmin);

  return (
    <nav className="border-b border-slate-200 bg-white" aria-label="Main">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap",
                active
                  ? "border-sky-600 text-sky-800"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Server,
  Layers,
  ScrollText,
  Settings,
  Zap,
  BarChart3,
  Gauge,
  Compass,
  Terminal,
  FlaskConical,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/providers", label: "Providers", icon: Server },
  { href: "/pools", label: "Pools", icon: Layers },
  { href: "/benchmarks", label: "Benchmarks", icon: Gauge },
  { href: "/discovery", label: "Discovery", icon: Compass },
  { href: "/terminal", label: "Terminal", icon: Terminal },
  { href: "/playground", label: "Playground", icon: FlaskConical },
  { href: "/usage", label: "Usage", icon: BarChart3 },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-6">
        <Zap className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">LLM Router</span>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

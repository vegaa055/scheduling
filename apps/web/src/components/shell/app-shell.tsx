"use client";

import { CalendarDays, DoorOpen, Inbox, LogOut, Moon, Puzzle, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import type { Role } from "@sched/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { useMounted } from "@/hooks/use-mounted";
import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { useMe, usePendingCount } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: typeof CalendarDays; roles?: Role[] }[] = [
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/rooms", label: "Rooms", icon: DoorOpen },
  { href: "/requests", label: "Requests", icon: Inbox },
  { href: "/builder", label: "Builder", icon: Puzzle, roles: ["admin", "scheduler"] },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: me, isLoading } = useMe();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  const roles = me?.user.roles ?? [];
  const canReview = roles.some((r) => r === "admin" || r === "staff" || r === "scheduler");
  const { data: pending } = usePendingCount(!!me && canReview);
  useLiveUpdates(!!me);

  const signOut = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <nav
        aria-label="Main"
        className="hidden w-[76px] shrink-0 flex-col items-center bg-sidebar py-4 text-sidebar-foreground md:flex"
      >
        <Link
          href="/calendar"
          className="mb-6 flex size-10 items-center justify-center rounded-md bg-sidebar-primary font-numeral text-2xl font-bold leading-none text-white"
          aria-label={`${brand.appName}, ${brand.collegeName}`}
        >
          {brand.monogram}
        </Link>
        <ul className="flex flex-1 flex-col gap-1">
          {NAV.filter((n) => !n.roles || n.roles.some((r) => roles.includes(r))).map((n) => {
            const active = pathname.startsWith(n.href);
            const badge = n.href === "/requests" && pending?.count ? pending.count : 0;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex w-[64px] flex-col items-center gap-1 rounded-md py-2 text-[11px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-white"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                  )}
                >
                  {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-sidebar-primary" />}
                  <n.icon className="size-5" strokeWidth={1.75} />
                  {n.label}
                  {badge > 0 && (
                    <span className="absolute top-1 right-2 min-w-4 rounded-full bg-sidebar-primary px-1 text-center text-[10px] leading-4 text-white tabular">
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTheme(dark ? "light" : "dark")}
              className="mb-3 flex size-9 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white"
              aria-label="Switch light or dark theme"
            >
              {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Switch theme</TooltipContent>
        </Tooltip>
        {isLoading || !me ? (
          <Skeleton className="size-9 rounded-full bg-sidebar-accent" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full focus-visible:ring-2 focus-visible:ring-sidebar-ring" aria-label="Account">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-white">
                    {initials(me.user.displayName)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <div className="font-semibold">{me.user.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {me.user.title}
                  {me.user.departmentName ? `, ${me.user.departmentName}` : ""}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {me.user.roles.map((r) => (
                    <span key={r} className="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">
                      {r}
                    </span>
                  ))}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {children}
        {/* Bottom navigation on phones */}
        <nav aria-label="Main" className="flex border-t bg-sidebar text-sidebar-foreground md:hidden">
          {NAV.filter((n) => !n.roles || n.roles.some((r) => roles.includes(r))).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname.startsWith(n.href) ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
                pathname.startsWith(n.href) ? "text-white" : "text-sidebar-foreground/75",
              )}
            >
              <n.icon className="size-5" strokeWidth={1.75} />
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

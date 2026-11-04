"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import type { Role } from "@sched/shared";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

export { useDefaultTerm } from "@/hooks/use-default-term";

export const ADMIN_TABS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/admin/people", label: "People", roles: ["admin"] },
  { href: "/admin/departments", label: "Departments", roles: ["admin"] },
  { href: "/admin/rooms", label: "Rooms", roles: ["admin"] },
  { href: "/admin/terms", label: "Terms", roles: ["admin", "scheduler"] },
  { href: "/admin/import", label: "Import sections", roles: ["admin", "scheduler"] },
];

export const allowedTabs = (roles: Role[]) => ADMIN_TABS.filter((t) => t.roles.some((r) => roles.includes(r)));

/**
 * Renders its children only in the browser. Admin screens depend on who is signed in, which
 * the server doesn't know, so they show a placeholder until the page has hydrated.
 */
export function Hydrated({ children }: { children: React.ReactNode }) {
  return useMounted() ? children : <Skeleton className="h-64" />;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mounted = useMounted();
  const { data } = useMe();
  // The page always renders (Next.js validates it on the server); who may see it is only known in the browser.
  const me = mounted ? data : undefined;
  const tabs = allowedTabs(me?.user.roles ?? []);
  const tab = ADMIN_TABS.find((t) => pathname.startsWith(t.href));
  const allowed = !me || (tab ? tabs.includes(tab) : tabs.length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      <header className="border-b bg-card px-4 pt-4 sm:px-6">
        <h1 className="font-numeral text-[28px] leading-none font-semibold">Admin</h1>
        <nav aria-label="Admin sections" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
          {me
            ? tabs.map((t) => {
                const active = pathname.startsWith(t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "shrink-0 border-b-2 px-3 pt-1 pb-2.5 text-sm font-medium transition-colors",
                      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </Link>
                );
              })
            : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-2.5 h-6 w-20" />)}
        </nav>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {allowed ? (
          children
        ) : (
          <p className="text-sm text-muted-foreground">
            {tabs.length ? "This part of Admin is for college admins." : "Admin is for college admins and schedulers."}
          </p>
        )}
      </div>
    </div>
  );
}

/** A labelled form control with an optional hint and error, wired up for screen readers. */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Field errors from a 400 response, keyed by field path. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.issues.length) return {};
  const out: Record<string, string> = {};
  for (const i of e.issues) out[i.path] ??= i.message;
  return out;
}

export const errorText = (e: unknown, fallback = "Something went wrong. Try again.") =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;

/** lecture_capture → Lecture capture */
export const featureLabel = (slug: string) => {
  const s = slug.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</p>;
}

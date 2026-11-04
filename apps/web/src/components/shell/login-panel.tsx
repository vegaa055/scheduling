"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, KeyRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Role } from "@sched/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { brand } from "@/lib/brand";
import { useMounted } from "@/hooks/use-mounted";
import { campusNow, inCampus } from "@/lib/time";

interface DevUser {
  id: string;
  netid: string;
  displayName: string;
  title: string | null;
  roles: Role[];
  departmentName: string | null;
}

const ROLE_ORDER: Role[] = ["admin", "scheduler", "staff", "faculty", "viewer"];

export function LoginPanel() {
  const [returnTo, setReturnTo] = useState("/calendar");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get("returnTo");
    if (r && r.startsWith("/") && !r.startsWith("//")) setReturnTo(r);
    if (p.get("error") === "saml") setError("Campus sign-in didn't complete. Try again, or contact the help desk if it keeps happening.");
  }, []);

  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api<{ mode: string; loginUrl: string | null }>("/auth/config") });
  const devUsers = useQuery({
    queryKey: ["dev-users"],
    queryFn: () => api<DevUser[]>("/auth/dev/users"),
    enabled: config.data?.mode === "dev",
  });

  const grouped = useMemo(() => {
    const list = (devUsers.data ?? []).filter((u) =>
      `${u.displayName} ${u.netid} ${u.departmentName}`.toLowerCase().includes(filter.toLowerCase()),
    );
    return list.sort(
      (a, b) =>
        Math.min(...a.roles.map((r) => ROLE_ORDER.indexOf(r))) - Math.min(...b.roles.map((r) => ROLE_ORDER.indexOf(r))) ||
        a.displayName.localeCompare(b.displayName),
    );
  }, [devUsers.data, filter]);

  const devLogin = async (netid: string) => {
    setBusy(netid);
    try {
      await api("/auth/dev/login", { method: "POST", json: { netid } });
      window.location.href = returnTo;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(null);
    }
  };

  const mounted = useMounted();
  const now = mounted ? campusNow() : null;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand-midnight text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* A week of hour lines, the shape of the product */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10]">
          <div className="grid h-full grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="border-l border-white" />
            ))}
          </div>
          <div className="absolute inset-0 grid grid-rows-12">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="border-t border-white" />
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-brand-red font-numeral text-2xl font-bold">
            {brand.monogram}
          </span>
          <span className="text-sm font-medium text-white/80">{brand.collegeName}</span>
        </div>
        <div className="relative">
          <p className="min-h-[15rem] font-numeral text-[9rem] leading-[0.82] font-semibold tracking-tight">
            {now && (
              <>
                {format(now, "EEE", { in: inCampus })}
                <br />
                {format(now, "MMM d", { in: inCampus })}
              </>
            )}
          </p>
          <p className="mt-8 max-w-md text-lg text-white/80">
            Classes, rooms, office hours and meetings for the whole college, in one calendar.
          </p>
        </div>
        <p className="relative text-xs text-white/50">Times shown in Arizona time (MST, no daylight saving).</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to {brand.appName}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Use your campus account. Your roles come from the directory.</p>

          {error && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="mt-8">
            {config.isLoading && <Skeleton className="h-10 w-full" />}
            {config.isError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>The scheduling service isn&apos;t responding. Check that the API is running on port 4000.</AlertDescription>
              </Alert>
            )}
            {config.data?.mode === "saml" && (
              <Button asChild size="lg" className="w-full">
                <a href={`/api/auth/saml/login?returnTo=${encodeURIComponent(returnTo)}`}>
                  <KeyRound /> Sign in with NetID
                </a>
              </Button>
            )}
            {config.data?.mode === "header" && (
              <p className="text-sm text-muted-foreground">
                Sign-in is handled by the campus web server. Reload the page to continue.
              </p>
            )}
            {config.data?.mode === "dev" && (
              <div>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">Development sign-in</h2>
                  <span className="text-xs text-muted-foreground">Local only</span>
                </div>
                <Input
                  placeholder="Filter people"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="mb-2"
                  aria-label="Filter people"
                />
                <ul className="max-h-[52vh] divide-y overflow-y-auto rounded-md border bg-card scrollbar-thin">
                  {devUsers.isLoading &&
                    Array.from({ length: 6 }).map((_, i) => (
                      <li key={i} className="p-3">
                        <Skeleton className="h-4 w-2/3" />
                      </li>
                    ))}
                  {grouped.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => devLogin(u.netid)}
                        disabled={!!busy}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{u.displayName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {u.title}
                            {u.departmentName ? `, ${u.departmentName}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                          {busy === u.netid ? "Signing in…" : u.roles.join(", ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

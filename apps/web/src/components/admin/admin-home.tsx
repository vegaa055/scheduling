"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/queries";
import { allowedTabs } from "./common";

/** /admin opens the first section this person can use. */
export function AdminHome() {
  const router = useRouter();
  const { data: me } = useMe();
  const first = me ? allowedTabs(me.user.roles)[0] : undefined;
  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);
  return <Skeleton className="h-64" />;
}

"use client";

import { useMemo, useState } from "react";
import type { TermDTO } from "@sched/shared";
import { parseYmd } from "@/lib/time";

/** Picks the term being planned (the next one that hasn't started, else the current one) until someone chooses another. */
export function useDefaultTerm(terms: TermDTO[]) {
  const [chosen, setChosen] = useState<string>();
  const fallback = useMemo(() => {
    if (terms.length === 0) return undefined;
    const upcoming = terms.find((t) => parseYmd(t.startsOn) > new Date());
    return (upcoming ?? terms.find((t) => t.isCurrent) ?? terms[0])!.id;
  }, [terms]);
  return [chosen ?? fallback, setChosen] as const;
}

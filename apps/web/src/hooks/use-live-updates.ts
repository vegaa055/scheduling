"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

type Change =
  | { type: "calendar.changed"; calendarIds: string[] }
  | { type: "booking.changed"; bookingId: string }
  | { type: "solver.progress"; runId: string; status: string; score?: string | null }
  | { type: "sections.changed"; termId: string };

/** Subscribes to the API's Server-Sent Events stream and refreshes whatever changed. */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/stream");
    es.addEventListener("change", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as Change;
      switch (msg.type) {
        case "calendar.changed":
          qc.invalidateQueries({ queryKey: ["events"] });
          qc.invalidateQueries({ queryKey: ["rooms-board"] });
          break;
        case "booking.changed":
          qc.invalidateQueries({ queryKey: ["bookings"] });
          break;
        case "solver.progress":
          qc.invalidateQueries({ queryKey: ["solver-run", msg.runId] });
          qc.invalidateQueries({ queryKey: ["solver-runs"] });
          break;
        case "sections.changed":
          qc.invalidateQueries({ queryKey: ["sections", msg.termId] });
          break;
      }
    });
    return () => es.close();
  }, [enabled, qc]);
}

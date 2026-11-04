import type { CalendarColor, EventKind } from "@sched/shared";

/** CSS for an event block in a calendar color: tinted fill, solid bar, legible ink. */
export function eventStyle(color: CalendarColor | string): React.CSSProperties {
  return {
    "--ev": `var(--cal-${color})`,
    "--ev-ink": `var(--cal-${color}-ink)`,
    backgroundColor: `color-mix(in oklab, var(--cal-${color}) var(--tint), var(--card))`,
    color: `var(--cal-${color}-ink)`,
  } as React.CSSProperties;
}

export const swatch = (color: CalendarColor | string) => ({ backgroundColor: `var(--cal-${color})` });

export const KIND_GLYPH: Partial<Record<EventKind, string>> = {
  exam: "Exam",
  deadline: "Due",
  hold: "Hold",
  office_hours: "OH",
};

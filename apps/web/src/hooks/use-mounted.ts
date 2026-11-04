"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during server prerender, true in the browser. Lets clock-dependent UI render client-side only. */
export function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

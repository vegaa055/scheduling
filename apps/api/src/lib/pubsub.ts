import { EventEmitter } from "node:events";
import { redis, subscriber } from "./redis.ts";

/**
 * Change notifications fan out through Redis so every API instance can push them to its
 * connected browsers over Server-Sent Events.
 */
export type ChangeMessage =
  | { type: "calendar.changed"; calendarIds: string[] }
  | { type: "booking.changed"; bookingId: string }
  | { type: "solver.progress"; runId: string; status: string; score?: string | null }
  | { type: "sections.changed"; termId: string };

const CHANNEL = "sched:changes";
export const localBus = new EventEmitter();
localBus.setMaxListeners(0);

let started = false;
export async function startSubscriber() {
  if (started) return;
  started = true;
  await subscriber.connect();
  await subscriber.subscribe(CHANNEL);
  subscriber.on("message", (_channel, raw) => {
    try {
      localBus.emit("change", JSON.parse(raw) as ChangeMessage);
    } catch {
      /* ignore malformed */
    }
  });
}

export async function publish(msg: ChangeMessage) {
  await redis.publish(CHANNEL, JSON.stringify(msg));
}

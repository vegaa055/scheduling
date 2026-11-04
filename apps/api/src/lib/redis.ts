import { Redis } from "ioredis";
import { env } from "../env.ts";

/** General-purpose connection: sessions, cache, publishing. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });

/** BullMQ needs maxRetriesPerRequest = null on its connections. */
export function bullConnection() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

/** Dedicated subscriber connection (a subscribed client can't issue other commands). */
export const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

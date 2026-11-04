import { redis } from "./redis.ts";

/**
 * Versioned cache: each namespace (a calendar, the room board) has a counter. Bumping the counter
 * makes every key built from the old version unreachable; they expire on their own TTL.
 */
export async function getVersion(ns: string): Promise<number> {
  const v = await redis.get(`ver:${ns}`);
  return v ? Number(v) : 0;
}

export async function bump(...namespaces: string[]) {
  if (namespaces.length === 0) return;
  const pipe = redis.pipeline();
  for (const ns of namespaces) pipe.incr(`ver:${ns}`);
  await pipe.exec();
}

export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis unavailable: fall through to the database.
  }
  const value = await load();
  redis.set(key, JSON.stringify(value), "EX", ttlSeconds).catch(() => {});
  return value;
}

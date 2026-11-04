import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, sql } from "drizzle-orm";
import type { Role } from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import type { SessionUser } from "../lib/access.ts";
import { rolesFromAttributes, type IdentityAttributes } from "./roles.ts";
export type { IdentityAttributes } from "./roles.ts";
import { HttpError } from "../lib/errors.ts";
import { redis } from "../lib/redis.ts";

export const SESSION_COOKIE = "sched_sid";
const ttlSeconds = () => env.SESSION_TTL_HOURS * 3600;

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
  }
}

interface SessionData {
  userId: string;
  createdAt: number;
  via: "saml" | "header" | "dev";
}

export async function loadUser(userId: string): Promise<SessionUser | null> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u) return null;
  return {
    id: u.id,
    netid: u.netid,
    email: u.email,
    displayName: u.displayName,
    title: u.title,
    roles: u.roles as Role[],
    departmentId: u.departmentId,
  };
}

export async function createSession(reply: FastifyReply, userId: string, via: SessionData["via"]) {
  const sid = randomBytes(32).toString("base64url");
  const data: SessionData = { userId, createdAt: Date.now(), via };
  await redis.set(`sess:${sid}`, JSON.stringify(data), "EX", ttlSeconds());
  await db.update(schema.users).set({ lastLoginAt: sql`now()` }).where(eq(schema.users.id, userId));
  reply.setCookie(SESSION_COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    signed: true,
    maxAge: ttlSeconds(),
  });
  return sid;
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.sessionId) await redis.del(`sess:${req.sessionId}`);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Creates or refreshes the local user record from IdP attributes. */
export async function upsertFromIdentity(a: IdentityAttributes): Promise<string> {
  const roles = rolesFromAttributes(a);
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.netid, a.netid)).limit(1);
  if (existing) {
    await db
      .update(schema.users)
      .set({
        email: a.email ?? existing.email,
        displayName: a.displayName ?? existing.displayName,
        affiliations: a.affiliations,
        ...(existing.rolesLocked ? {} : { roles }),
      })
      .where(eq(schema.users.id, existing.id));
    return existing.id;
  }
  const [created] = await db
    .insert(schema.users)
    .values({
      netid: a.netid,
      email: a.email ?? `${a.netid}@localhost`,
      displayName: a.displayName ?? a.netid,
      affiliations: a.affiliations,
      roles,
    })
    .returning({ id: schema.users.id });
  // Everyone gets a personal calendar.
  await db.insert(schema.calendars).values({
    name: a.displayName ?? a.netid,
    kind: "personal",
    ownerId: created!.id,
    isPublic: false,
    color: "mesa",
  });
  return created!.id;
}

/* ---------------- Header mode (Shibboleth SP in front of the API) ---------------- */

const splitMulti = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(";") : (v ?? "")).split(/[;,]/).map((s) => s.trim()).filter(Boolean);

async function userFromHeaders(req: FastifyRequest): Promise<SessionUser | null> {
  const trusted = env.HEADER_TRUSTED_PROXIES.split(",").map((s) => s.trim());
  if (!trusted.includes(req.ip)) return null;
  const principal = req.headers[env.HEADER_USER.toLowerCase()];
  if (!principal || Array.isArray(principal)) return null;
  const netid = principal.replace(/@.*$/, "");
  const cacheKey = `hdr-user:${netid}`;
  let userId = await redis.get(cacheKey);
  if (!userId) {
    userId = await upsertFromIdentity({
      netid,
      email: req.headers[env.HEADER_EMAIL.toLowerCase()] as string | undefined,
      displayName: req.headers[env.HEADER_NAME.toLowerCase()] as string | undefined,
      affiliations: splitMulti(req.headers[env.HEADER_AFFILIATION.toLowerCase()]),
      groups: splitMulti(req.headers[env.HEADER_GROUPS.toLowerCase()]),
    });
    await redis.set(cacheKey, userId, "EX", 300);
  }
  return loadUser(userId);
}

/* ---------------- Request hooks ---------------- */

export function registerSessionHooks(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);

  app.addHook("onRequest", async (req) => {
    if (env.AUTH_MODE === "header") {
      req.user = await userFromHeaders(req);
      return;
    }
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const json = await redis.get(`sess:${unsigned.value}`);
    if (!json) return;
    const data = JSON.parse(json) as SessionData;
    req.sessionId = unsigned.value;
    req.user = await loadUser(data.userId);
    // sliding expiry
    redis.expire(`sess:${unsigned.value}`, ttlSeconds()).catch(() => {});
  });

  // CSRF: mutating requests must come from our own origin. Cookies are SameSite=Lax as well.
  app.addHook("onRequest", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.url.startsWith("/auth/saml/acs")) return; // cross-site POST from the IdP by design
    const origin = req.headers.origin ?? req.headers.referer;
    if (!origin) return; // non-browser clients (curl, tests)
    if (!origin.startsWith(env.APP_ORIGIN)) {
      throw new HttpError(403, "bad_origin", "Request origin not allowed");
    }
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Sign in to continue");
  return req.user;
}

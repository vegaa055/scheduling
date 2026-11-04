import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { audit } from "../lib/audit.ts";
import { badRequest, HttpError } from "../lib/errors.ts";
import { getSaml, identityFromProfile } from "../auth/saml.ts";
import { createSession, destroySession, upsertFromIdentity } from "../auth/session.ts";

/** Only allow redirects back into our own app. */
function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/calendar";
  return value;
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/config", async () => ({
    mode: env.AUTH_MODE,
    loginUrl: env.AUTH_MODE === "saml" ? "/api/auth/saml/login" : null,
  }));

  app.post("/auth/logout", async (req, reply) => {
    if (req.user) await audit(req.user.id, "logout", "user", req.user.id);
    await destroySession(req, reply);
    return { ok: true };
  });

  /* ---------------- SAML ---------------- */

  app.get("/auth/saml/login", async (req, reply) => {
    if (env.AUTH_MODE !== "saml") throw badRequest("SAML sign-in is not enabled");
    const saml = await getSaml();
    const returnTo = safeReturnTo((req.query as Record<string, unknown>).returnTo);
    const url = await saml.getAuthorizeUrlAsync(returnTo, {});
    return reply.redirect(url);
  });

  app.post("/auth/saml/acs", async (req, reply) => {
    if (env.AUTH_MODE !== "saml") throw badRequest("SAML sign-in is not enabled");
    const body = req.body as Record<string, string>;
    if (!body?.SAMLResponse) throw badRequest("Missing SAMLResponse");
    const saml = await getSaml();
    try {
      const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse });
      if (!profile) throw new Error("No profile in assertion");
      const identity = identityFromProfile(profile);
      const userId = await upsertFromIdentity(identity);
      await createSession(reply, userId, "saml");
      await audit(userId, "login", "user", userId, { via: "saml", issuer: profile.issuer });
      return reply.redirect(`${env.APP_ORIGIN}${safeReturnTo(body.RelayState)}`);
    } catch (err) {
      req.log.warn({ err }, "SAML assertion rejected");
      return reply.redirect(`${env.APP_ORIGIN}/login?error=saml`);
    }
  });

  app.get("/auth/saml/metadata", async (_req, reply) => {
    const saml = await getSaml();
    reply.type("application/samlmetadata+xml");
    return saml.generateServiceProviderMetadata(env.SAML_SP_CERT ?? null, env.SAML_SP_CERT ?? null);
  });

  /* ---------------- Development user picker ---------------- */

  const devGuard = () => {
    if (env.AUTH_MODE !== "dev" || env.NODE_ENV === "production") {
      throw new HttpError(404, "not_found", "Not found");
    }
  };

  app.get("/auth/dev/users", async () => {
    devGuard();
    const rows = await db
      .select({
        id: schema.users.id,
        netid: schema.users.netid,
        displayName: schema.users.displayName,
        title: schema.users.title,
        roles: schema.users.roles,
        departmentName: schema.departments.name,
      })
      .from(schema.users)
      .leftJoin(schema.departments, eq(schema.departments.id, schema.users.departmentId))
      .orderBy(asc(schema.users.displayName));
    return rows;
  });

  app.post("/auth/dev/login", async (req, reply) => {
    devGuard();
    const { netid } = z.object({ netid: z.string() }).parse(req.body);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.netid, netid)).limit(1);
    if (!u) throw new HttpError(404, "not_found", "No such user");
    await createSession(reply, u.id, "dev");
    await audit(u.id, "login", "user", u.id, { via: "dev" });
    return { ok: true };
  });
}

import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("127.0.0.1"),
  /** Public origin of the web app, used for redirects and the Origin check on writes. */
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://sched:sched@localhost:5544/sched"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  SOLVER_URL: z.string().url().default("http://localhost:8095"),
  SESSION_SECRET: z.string().min(32).default("dev-only-session-secret-change-me-0123456789"),
  SESSION_TTL_HOURS: z.coerce.number().default(10),

  /** saml = SP-initiated SAML 2.0 (Shibboleth / SimpleSAMLphp IdP)
   *  header = trust attributes set by a Shibboleth SP in front of the API
   *  dev = local user picker (refused when NODE_ENV=production) */
  AUTH_MODE: z.enum(["saml", "header", "dev"]).default("dev"),

  SAML_SP_ENTITY_ID: z.string().default("http://localhost:3000/api/auth/saml/metadata"),
  SAML_ACS_URL: z.string().default("http://localhost:3000/api/auth/saml/acs"),
  /** Either the metadata URL, or the SSO URL + signing cert. */
  SAML_IDP_METADATA_URL: z.string().optional(),
  SAML_IDP_SSO_URL: z.string().optional(),
  SAML_IDP_CERT: z.string().optional(),
  SAML_SP_PRIVATE_KEY: z.string().optional(),
  SAML_SP_CERT: z.string().optional(),
  /** isMemberOf / group values that grant elevated roles (comma separated). */
  SAML_ADMIN_GROUPS: z.string().default("sched-admins"),
  SAML_SCHEDULER_GROUPS: z.string().default("sched-schedulers"),

  /** header mode: names of the headers the Shibboleth SP sets. */
  HEADER_USER: z.string().default("eppn"),
  HEADER_EMAIL: z.string().default("mail"),
  HEADER_NAME: z.string().default("displayname"),
  HEADER_AFFILIATION: z.string().default("affiliation"),
  HEADER_GROUPS: z.string().default("ismemberof"),
  /** Comma-separated proxy addresses allowed to set identity headers. */
  HEADER_TRUSTED_PROXIES: z.string().default("127.0.0.1,::1"),
});

export const env = schema.parse(process.env);

if (env.NODE_ENV === "production") {
  if (env.AUTH_MODE === "dev") throw new Error("AUTH_MODE=dev is not allowed in production");
  if (env.SESSION_SECRET.startsWith("dev-only")) throw new Error("Set SESSION_SECRET in production");
}

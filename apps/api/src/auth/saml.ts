import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import { env } from "../env.ts";
import { redis } from "../lib/redis.ts";
import type { IdentityAttributes } from "./session.ts";

/**
 * SAML 2.0 Service Provider.
 *
 * Works against the campus Shibboleth IdP in production and the SimpleSAMLphp test IdP in
 * docker-compose locally. Configure either SAML_IDP_METADATA_URL (preferred: SSO URL and signing
 * certificate are read from metadata at startup) or SAML_IDP_SSO_URL + SAML_IDP_CERT.
 */

/** Redis-backed request-ID cache so InResponseTo is validated across API instances. */
const redisCache: CacheProvider = {
  async saveAsync(key, value) {
    await redis.set(`saml:req:${key}`, value, "EX", 600);
    return { value, createdAt: Date.now() };
  },
  async getAsync(key) {
    return redis.get(`saml:req:${key}`);
  },
  async removeAsync(key) {
    if (!key) return null;
    const v = await redis.get(`saml:req:${key}`);
    await redis.del(`saml:req:${key}`);
    return v;
  },
  async consumeAsync(key) {
    return redis.getdel(`saml:req:${key}`);
  },
  async saveIfAbsentAsync(key, value, expiresAtMs) {
    const ttl = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000));
    const ok = await redis.set(`saml:seen:${key}`, value, "EX", ttl, "NX");
    return ok === "OK";
  },
};

interface IdpConfig {
  ssoUrl: string;
  certs: string[];
}

async function resolveIdp(): Promise<IdpConfig> {
  if (env.SAML_IDP_METADATA_URL) {
    const res = await fetch(env.SAML_IDP_METADATA_URL);
    if (!res.ok) throw new Error(`IdP metadata fetch failed: ${res.status}`);
    const xml = await res.text();
    const ssoMatch = xml.match(
      /<(?:\w+:)?SingleSignOnService[^>]*Binding="urn:oasis:names:tc:SAML:2\.0:bindings:HTTP-Redirect"[^>]*Location="([^"]+)"/,
    ) ?? xml.match(/<(?:\w+:)?SingleSignOnService[^>]*Location="([^"]+)"[^>]*Binding="urn:oasis:names:tc:SAML:2\.0:bindings:HTTP-Redirect"/);
    // Signing keys: KeyDescriptor use="signing" or no use attribute.
    const certs = [...xml.matchAll(/<(?:\w+:)?KeyDescriptor(?![^>]*use="encryption")[^>]*>[\s\S]*?<(?:\w+:)?X509Certificate>([\s\S]*?)<\/(?:\w+:)?X509Certificate>/g)]
      .map((m) => m[1]!.replace(/\s+/g, ""));
    if (!ssoMatch || certs.length === 0) throw new Error("IdP metadata is missing an SSO endpoint or signing certificate");
    return { ssoUrl: env.SAML_IDP_SSO_URL ?? ssoMatch[1]!, certs: [...new Set(certs)] };
  }
  if (!env.SAML_IDP_SSO_URL || !env.SAML_IDP_CERT) {
    throw new Error("Set SAML_IDP_METADATA_URL, or SAML_IDP_SSO_URL and SAML_IDP_CERT");
  }
  return { ssoUrl: env.SAML_IDP_SSO_URL, certs: [env.SAML_IDP_CERT.replace(/\s+/g, "")] };
}

let samlPromise: Promise<SAML> | null = null;

export function getSaml(): Promise<SAML> {
  samlPromise ??= resolveIdp()
    .then(
      (idp) =>
        new SAML({
          entryPoint: idp.ssoUrl,
          issuer: env.SAML_SP_ENTITY_ID,
          callbackUrl: env.SAML_ACS_URL,
          idpCert: idp.certs,
          wantAssertionsSigned: true,
          wantAuthnResponseSigned: false,
          identifierFormat: null,
          disableRequestedAuthnContext: true,
          acceptedClockSkewMs: 60_000,
          validateInResponseTo: ValidateInResponseTo.always,
          requestIdExpirationPeriodMs: 10 * 60_000,
          cacheProvider: redisCache,
          signatureAlgorithm: "sha256",
          ...(env.SAML_SP_PRIVATE_KEY ? { privateKey: env.SAML_SP_PRIVATE_KEY } : {}),
          ...(env.SAML_SP_PRIVATE_KEY ? { decryptionPvk: env.SAML_SP_PRIVATE_KEY } : {}),
        }),
    )
    .catch((err) => {
      samlPromise = null; // retry on next login
      throw err;
    });
  return samlPromise;
}

/** Friendly names (SimpleSAMLphp) and OIDs (Shibboleth / InCommon) for the attributes we use. */
const ATTR = {
  principal: ["eduPersonPrincipalName", "urn:oid:1.3.6.1.4.1.5923.1.1.1.6", "uid", "urn:oid:0.9.2342.19200300.100.1.1"],
  email: ["mail", "email", "urn:oid:0.9.2342.19200300.100.1.3"],
  displayName: ["displayName", "urn:oid:2.16.840.1.113730.3.1.241", "cn", "urn:oid:2.5.4.3"],
  affiliation: [
    "eduPersonAffiliation",
    "urn:oid:1.3.6.1.4.1.5923.1.1.1.1",
    "eduPersonScopedAffiliation",
    "urn:oid:1.3.6.1.4.1.5923.1.1.1.9",
  ],
  groups: ["isMemberOf", "urn:oid:1.3.6.1.4.1.5923.1.5.1.1", "memberOf"],
};

function pick(profile: Profile, names: string[]): string[] {
  for (const n of names) {
    const v = profile[n];
    if (v === undefined || v === null) continue;
    const list = (Array.isArray(v) ? v : [v]).map(String).filter(Boolean);
    if (list.length) return list;
  }
  return [];
}

export function identityFromProfile(profile: Profile): IdentityAttributes {
  const principal = pick(profile, ATTR.principal)[0] ?? profile.nameID;
  if (!principal) throw new Error("Assertion did not include a user identifier");
  return {
    netid: principal.replace(/@.*$/, "").toLowerCase(),
    email: pick(profile, ATTR.email)[0],
    displayName: pick(profile, ATTR.displayName)[0],
    affiliations: [...new Set(pick(profile, ATTR.affiliation).map((a) => a.replace(/@.*$/, "")))],
    groups: pick(profile, ATTR.groups),
  };
}

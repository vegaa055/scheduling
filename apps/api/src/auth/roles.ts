import type { Role } from "@sched/shared";
import { env } from "../env.ts";

export interface IdentityAttributes {
  netid: string;
  email?: string;
  displayName?: string;
  affiliations: string[];
  groups: string[];
}

/** Maps eduPerson affiliations and group memberships to app roles. */
export function rolesFromAttributes(a: IdentityAttributes): Role[] {
  const roles = new Set<Role>();
  const groups = a.groups.map((g) => g.toLowerCase());
  const has = (list: string) => list.split(",").some((g) => groups.includes(g.trim().toLowerCase()));
  if (has(env.SAML_ADMIN_GROUPS)) roles.add("admin");
  if (has(env.SAML_SCHEDULER_GROUPS)) roles.add("scheduler");
  const aff = a.affiliations.map((x) => x.toLowerCase().replace(/@.*$/, ""));
  if (aff.includes("faculty")) roles.add("faculty");
  // eduPerson gives faculty "employee" too, so "employee" only means staff when it's the
  // person's only employment affiliation.
  if (aff.includes("staff") || (aff.includes("employee") && !aff.includes("faculty"))) roles.add("staff");
  if (roles.size === 0) roles.add("viewer");
  return [...roles];
}

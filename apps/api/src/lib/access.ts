import { and, eq } from "drizzle-orm";
import type { CalendarColor, CalendarDTO, Role } from "@sched/shared";
import { db, schema } from "../db/client.ts";
import { forbidden } from "./errors.ts";

export interface SessionUser {
  id: string;
  netid: string;
  email: string;
  displayName: string;
  title: string | null;
  roles: Role[];
  departmentId: string | null;
}

export const hasRole = (user: SessionUser, ...roles: Role[]) => user.roles.some((r) => roles.includes(r));

export function requireRole(user: SessionUser, ...roles: Role[]) {
  if (!hasRole(user, ...roles)) throw forbidden();
}

export type Access = CalendarDTO["access"] | null;
type CalendarRow = typeof schema.calendars.$inferSelect;

/**
 * Who can do what on a calendar:
 *  - admins own everything
 *  - explicit membership wins next
 *  - personal calendars belong to their owner
 *  - department staff and schedulers edit their department's calendar
 *  - staff and schedulers edit room calendars (others send booking requests)
 *  - schedulers edit course calendars
 *  - staff edit the college calendar
 *  - public calendars are readable by everyone signed in
 */
export function accessFor(user: SessionUser, cal: CalendarRow, memberRole?: string | null): Access {
  if (hasRole(user, "admin")) return "owner";
  if (memberRole === "owner" || memberRole === "editor" || memberRole === "viewer") return memberRole;
  if (cal.kind === "personal" && cal.ownerId === user.id) return "owner";
  if (cal.kind === "department" && cal.departmentId === user.departmentId && hasRole(user, "staff", "scheduler")) {
    return "editor";
  }
  if (cal.kind === "room" && hasRole(user, "staff", "scheduler")) return "editor";
  if (cal.kind === "course" && hasRole(user, "scheduler")) return "editor";
  if (cal.kind === "college" && hasRole(user, "staff")) return "editor";
  return cal.isPublic ? "viewer" : null;
}

function calendarsWithMembership(user: SessionUser) {
  return db
    .select({ cal: schema.calendars, memberRole: schema.calendarMembers.role })
    .from(schema.calendars)
    .leftJoin(
      schema.calendarMembers,
      and(eq(schema.calendarMembers.calendarId, schema.calendars.id), eq(schema.calendarMembers.userId, user.id)),
    );
}

const kindOrder = (k: string) => ["personal", "college", "department", "course", "room"].indexOf(k);

export async function visibleCalendars(user: SessionUser): Promise<CalendarDTO[]> {
  const rows = await calendarsWithMembership(user);
  const out: CalendarDTO[] = [];
  for (const { cal, memberRole } of rows) {
    const access = accessFor(user, cal, memberRole);
    if (access) out.push(toCalendarDTO(cal, access));
  }
  return out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name));
}

/** Map of calendarId → access for every calendar the user can see. */
export async function accessMap(user: SessionUser): Promise<Map<string, NonNullable<Access>>> {
  const rows = await calendarsWithMembership(user);
  const map = new Map<string, NonNullable<Access>>();
  for (const { cal, memberRole } of rows) {
    const access = accessFor(user, cal, memberRole);
    if (access) map.set(cal.id, access);
  }
  return map;
}

export function toCalendarDTO(cal: CalendarRow, access: NonNullable<Access>): CalendarDTO {
  return {
    id: cal.id,
    name: cal.name,
    description: cal.description,
    color: cal.color as CalendarColor,
    kind: cal.kind,
    isPublic: cal.isPublic,
    departmentId: cal.departmentId,
    roomId: cal.roomId,
    ownerId: cal.ownerId,
    access,
  };
}

export async function calendarAccess(user: SessionUser, calendarId: string): Promise<Access> {
  const [row] = await calendarsWithMembership(user).where(eq(schema.calendars.id, calendarId)).limit(1);
  return row ? accessFor(user, row.cal, row.memberRole) : null;
}

export const canEdit = (a: Access) => a === "owner" || a === "editor";

export async function requireCalendarEdit(user: SessionUser, calendarId: string) {
  if (!canEdit(await calendarAccess(user, calendarId))) {
    throw forbidden("You can't add or change events on this calendar");
  }
}

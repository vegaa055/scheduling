"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminUserDTO,
  AvailabilityBlockDTO,
  BookingDTO,
  BuildingDTO,
  CalendarDTO,
  ConflictDTO,
  DepartmentDTO,
  EventDetailDTO,
  OccurrenceDTO,
  PatternDTO,
  Role,
  RoomBusyDTO,
  RoomDTO,
  SectionDTO,
  SolverRunDTO,
  TermDTO,
  UserDTO,
} from "@sched/shared";
import { api } from "./api";

export type { PatternDTO };

export interface Me {
  user: UserDTO & { departmentName: string | null };
  calendars: CalendarDTO[];
}

export const qk = {
  me: ["me"] as const,
  events: (from: string, to: string, cals: string[]) => ["events", from, to, cals.join(",")] as const,
  event: (id: string) => ["event", id] as const,
  rooms: ["rooms"] as const,
  board: (date: string) => ["rooms-board", date] as const,
  terms: ["terms"] as const,
  bookings: (scope: string) => ["bookings", scope] as const,
  pending: ["bookings", "pending-count"] as const,
  sections: (termId: string) => ["sections", termId] as const,
  patterns: (termId: string) => ["patterns", termId] as const,
  runs: (termId: string) => ["solver-runs", termId] as const,
  run: (id: string) => ["solver-run", id] as const,
  adminUsers: (q: string, role: string) => ["admin-users", q, role] as const,
  departments: ["admin-departments"] as const,
  buildings: ["admin-buildings"] as const,
  availability: (termId: string, userId: string) => ["availability", termId, userId] as const,
  availabilitySummary: (termId: string) => ["availability-summary", termId] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<Me>("/me"), staleTime: 5 * 60_000 });

export function useOccurrences(from: Date, to: Date, calendarIds: string[] | null) {
  const f = from.toISOString();
  const t = to.toISOString();
  const cals = calendarIds ?? [];
  return useQuery({
    queryKey: qk.events(f, t, cals),
    queryFn: () =>
      cals.length === 0
        ? Promise.resolve([] as OccurrenceDTO[])
        : api<OccurrenceDTO[]>(`/events?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}&calendars=${cals.join(",")}`),
    enabled: calendarIds !== null,
    placeholderData: keepPreviousData,
  });
}

export const useEventDetail = (id: string | null) =>
  useQuery({ queryKey: qk.event(id ?? ""), queryFn: () => api<EventDetailDTO>(`/events/${id}`), enabled: !!id });

export const useRooms = () =>
  useQuery({ queryKey: qk.rooms, queryFn: () => api<RoomDTO[]>("/rooms"), staleTime: 10 * 60_000 });

export const useRoomBoard = (date: string) =>
  useQuery({ queryKey: qk.board(date), queryFn: () => api<RoomBusyDTO[]>(`/rooms/board?date=${date}`), placeholderData: keepPreviousData });

export const useTerms = () =>
  useQuery({ queryKey: qk.terms, queryFn: () => api<TermDTO[]>("/terms"), staleTime: 30 * 60_000 });

export const useBookings = (scope: "mine" | "review", enabled = true) =>
  useQuery({ queryKey: qk.bookings(scope), queryFn: () => api<BookingDTO[]>(`/bookings?scope=${scope}`), enabled });

export const usePendingCount = (enabled: boolean) =>
  useQuery({
    queryKey: qk.pending,
    queryFn: () => api<{ count: number }>("/bookings/pending-count"),
    enabled,
    refetchInterval: 60_000,
  });

export const useSections = (termId: string | undefined) =>
  useQuery({ queryKey: qk.sections(termId ?? ""), queryFn: () => api<SectionDTO[]>(`/terms/${termId}/sections`), enabled: !!termId });

export const usePatterns = (termId: string | undefined) =>
  useQuery({ queryKey: qk.patterns(termId ?? ""), queryFn: () => api<PatternDTO[]>(`/terms/${termId}/patterns`), enabled: !!termId });

export const useSolverRuns = (termId: string | undefined) =>
  useQuery({ queryKey: qk.runs(termId ?? ""), queryFn: () => api<SolverRunDTO[]>(`/solver/runs?termId=${termId}`), enabled: !!termId });

export const useSolverRun = (id: string | null) =>
  useQuery({ queryKey: qk.run(id ?? ""), queryFn: () => api<SolverRunDTO>(`/solver/runs/${id}`), enabled: !!id });

export interface Person {
  id: string;
  netid: string;
  displayName: string;
  title: string | null;
  departmentName: string | null;
}
export const usePeople = (q: string) =>
  useQuery({ queryKey: ["people", q], queryFn: () => api<Person[]>(`/people?q=${encodeURIComponent(q)}`), placeholderData: keepPreviousData });

/* ---------------- Admin ---------------- */

export const useAdminUsers = (q: string, role: Role | "all") =>
  useQuery({
    queryKey: qk.adminUsers(q, role),
    queryFn: () => api<AdminUserDTO[]>(`/admin/users?q=${encodeURIComponent(q)}${role === "all" ? "" : `&role=${role}`}`),
    placeholderData: keepPreviousData,
  });

export const useDepartments = () =>
  useQuery({ queryKey: qk.departments, queryFn: () => api<DepartmentDTO[]>("/admin/departments") });

export const useBuildings = () => useQuery({ queryKey: qk.buildings, queryFn: () => api<BuildingDTO[]>("/admin/buildings") });

export const useAvailability = (termId: string | undefined, userId: string | undefined, self: boolean) =>
  useQuery({
    queryKey: qk.availability(termId ?? "", userId ?? ""),
    queryFn: () => api<AvailabilityBlockDTO[]>(`/terms/${termId}/availability${self ? "" : `?userId=${userId}`}`),
    enabled: !!termId && !!userId,
  });

export interface InstructorSummary {
  id: string;
  displayName: string;
  netid: string;
  blocks: number;
}
export const useAvailabilitySummary = (termId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: qk.availabilitySummary(termId ?? ""),
    queryFn: () => api<InstructorSummary[]>(`/terms/${termId}/availability/summary`),
    enabled: enabled && !!termId,
  });

/** Invalidate everything that shows events. */
export function useInvalidateCalendar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["event"] });
    qc.invalidateQueries({ queryKey: ["rooms-board"] });
  };
}

export function useConflictCheck() {
  return useMutation({
    mutationFn: (body: {
      id?: string;
      startsAt: string;
      endsAt: string;
      rrule?: string | null;
      roomId?: string | null;
      attendeeIds?: string[];
      allDay?: boolean;
    }) => api<{ conflicts: ConflictDTO[] }>("/events/check", { method: "POST", json: body }),
  });
}

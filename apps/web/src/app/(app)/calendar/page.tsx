import type { Metadata } from "next";
import { CalendarScreen } from "@/components/calendar/calendar-screen";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return <CalendarScreen />;
}

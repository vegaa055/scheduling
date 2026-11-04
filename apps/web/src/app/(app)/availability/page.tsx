import type { Metadata } from "next";
import { AvailabilityScreen } from "@/components/availability/availability-screen";

export const metadata: Metadata = { title: "Teaching availability" };

export default function AvailabilityPage() {
  return <AvailabilityScreen />;
}

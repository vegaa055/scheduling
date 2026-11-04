import type { Metadata } from "next";
import { RequestsScreen } from "@/components/requests/requests-screen";

export const metadata: Metadata = { title: "Room requests" };

export default function RequestsPage() {
  return <RequestsScreen />;
}

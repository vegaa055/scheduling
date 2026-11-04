import type { Metadata } from "next";
import { RoomBoard } from "@/components/rooms/room-board";

export const metadata: Metadata = { title: "Rooms" };

export default function RoomsPage() {
  return <RoomBoard />;
}

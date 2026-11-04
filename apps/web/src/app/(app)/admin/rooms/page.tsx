import type { Metadata } from "next";
import { Hydrated } from "@/components/admin/common";
import { RoomsScreen } from "@/components/admin/rooms-screen";

export const metadata: Metadata = { title: "Rooms and buildings" };

export default function Page() {
  return (
    <Hydrated>
      <RoomsScreen />
    </Hydrated>
  );
}

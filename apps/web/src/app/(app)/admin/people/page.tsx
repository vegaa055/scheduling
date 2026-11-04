import type { Metadata } from "next";
import { Hydrated } from "@/components/admin/common";
import { PeopleScreen } from "@/components/admin/people-screen";

export const metadata: Metadata = { title: "People" };

export default function Page() {
  return (
    <Hydrated>
      <PeopleScreen />
    </Hydrated>
  );
}

import type { Metadata } from "next";
import { Hydrated } from "@/components/admin/common";
import { DepartmentsScreen } from "@/components/admin/departments-screen";

export const metadata: Metadata = { title: "Departments" };

export default function Page() {
  return (
    <Hydrated>
      <DepartmentsScreen />
    </Hydrated>
  );
}

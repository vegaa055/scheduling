import type { Metadata } from "next";
import { Hydrated } from "@/components/admin/common";
import { ImportScreen } from "@/components/admin/import-screen";

export const metadata: Metadata = { title: "Import sections" };

export default function Page() {
  return (
    <Hydrated>
      <ImportScreen />
    </Hydrated>
  );
}

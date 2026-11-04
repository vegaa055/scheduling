import type { Metadata } from "next";
import { Hydrated } from "@/components/admin/common";
import { TermsScreen } from "@/components/admin/terms-screen";

export const metadata: Metadata = { title: "Terms and meeting patterns" };

export default function Page() {
  return (
    <Hydrated>
      <TermsScreen />
    </Hydrated>
  );
}

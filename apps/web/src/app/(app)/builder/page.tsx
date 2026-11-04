import type { Metadata } from "next";
import { BuilderScreen } from "@/components/builder/builder-screen";

export const metadata: Metadata = { title: "Schedule builder" };

export default function BuilderPage() {
  return <BuilderScreen />;
}

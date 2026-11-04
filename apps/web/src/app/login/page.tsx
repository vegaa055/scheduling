import type { Metadata } from "next";
import { LoginPanel } from "@/components/shell/login-panel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <LoginPanel />;
}

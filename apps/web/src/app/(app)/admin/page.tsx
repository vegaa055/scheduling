import type { Metadata } from "next";
import { AdminHome } from "@/components/admin/admin-home";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return <AdminHome />;
}

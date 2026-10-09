import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
export const dynamic = "force-dynamic";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/admin/login?denied=1");
  return (
    <AdminShell nickname={user.nickname || user.email}>{children}</AdminShell>
  );
}

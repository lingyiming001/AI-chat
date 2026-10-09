import { notFound } from "next/navigation";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { ModelConsole } from "@/components/admin/ModelConsole";
export default async function AdminPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (section === "models") return <ModelConsole />;
  if (
    ![
      "users",
      "characters",
      "orders",
      "ledger",
      "audit",
      "settings",
      "requests",
    ].includes(section)
  )
    notFound();
  return <AdminConsole resource={section} />;
}

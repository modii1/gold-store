import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { getOtoConfigAction, getOtoEnvLabelAction } from "@/app/actions/oto-admin";
import { OtoManager } from "./oto-manager";

export const dynamic = "force-dynamic";

export default async function AdminOtoPage() {
  if (!(await getAdminSession())) redirect("/admin");
  const [config, envLabel] = await Promise.all([getOtoConfigAction(), getOtoEnvLabelAction()]);
  return <OtoManager initialConfig={config} envLabel={envLabel} />;
}

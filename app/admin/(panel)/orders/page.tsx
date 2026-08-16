import { getSettings } from "@/lib/services/settings";
import { getCarriers } from "@/lib/services/carriers";
import { queryOrders, parseOrdersParams } from "@/lib/orders/query";
import { OrdersManager } from "./orders-manager";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseOrdersParams(sp);

  const [result, carriers, settings] = await Promise.all([
    queryOrders(params),
    getCarriers(),
    getSettings(),
  ]);

  return (
    <OrdersManager
      orders={result.orders}
      total={result.total}
      pages={result.pages}
      page={result.page}
      limit={result.limit}
      stats={result.stats}
      params={params}
      carriers={carriers}
      settings={settings}
    />
  );
}

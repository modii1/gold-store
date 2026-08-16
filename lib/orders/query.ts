import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Order,
  OrderStats,
  OrderStatus,
  OrdersQueryParams,
  OrdersQueryResult,
  OrderSortKey,
} from "@/types";
import {
  ORDER_STATUS_META,
  PAYMENT_STATUS_META,
  SHIPPING_STATUS_META,
  derivePaymentStatus,
  deriveShippingStatus,
  isCod,
  isTransfer,
} from "./order-meta";

export const DEFAULT_LIMIT = 25;
export const LIMIT_OPTIONS = [25, 50, 100];
export const CSV_MAX_ROWS = 5000;

const SORT_COLUMNS: OrderSortKey[] = ["order_number", "created_at", "total", "status"];

export function parseOrdersParams(
  sp: Record<string, string | string[] | undefined>
): OrdersQueryParams {
  const s = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const limitRaw = parseInt(s("limit") || "", 10);
  const limit = LIMIT_OPTIONS.includes(limitRaw) ? limitRaw : DEFAULT_LIMIT;
  const pageRaw = parseInt(s("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const sortRaw = s("sort") as OrderSortKey | undefined;
  const sort = SORT_COLUMNS.includes(sortRaw as OrderSortKey) ? (sortRaw as OrderSortKey) : "created_at";
  const dir = s("dir") === "asc" ? "asc" : "desc";

  return {
    q: s("q")?.trim() || undefined,
    status: (s("status") as OrderStatus | "all") || "all",
    payment: s("payment") || "all",
    payment_method: s("payment_method") || "all",
    carrier: s("carrier") || "all",
    from: s("from") || undefined,
    to: s("to") || undefined,
    sort,
    dir,
    page,
    limit,
  };
}

/** Serialize query params to a URL query string (defaults omitted). */
export function buildOrdersQueryString(params: OrdersQueryParams): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.payment && params.payment !== "all") sp.set("payment", params.payment);
  if (params.payment_method && params.payment_method !== "all") sp.set("payment_method", params.payment_method);
  if (params.carrier && params.carrier !== "all") sp.set("carrier", params.carrier);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.sort && params.sort !== "created_at") sp.set("sort", params.sort);
  if (params.dir && params.dir !== "desc") sp.set("dir", params.dir);
  if (params.page && params.page !== 1) sp.set("page", String(params.page));
  if (params.limit && params.limit !== DEFAULT_LIMIT) sp.set("limit", String(params.limit));
  const str = sp.toString();
  return str ? `?${str}` : "";
}

function escSearch(q: string) {
  return q.replace(/[(),"*]/g, " ").replace(/\s+/g, " ").trim();
}

function buildFiltered(supabase: ReturnType<typeof createAdminClient>, params: OrdersQueryParams, base?: any) {
  let q = base || supabase.from("orders").select("*");

  if (params.q) {
    const qq = escSearch(params.q);
    if (qq) {
      const like = `%${qq}%`;
      const conds = [
        `customer_name.ilike.${like}`,
        `customer_phone.ilike.${like}`,
        `email.ilike.${like}`,
        `tracking_number.ilike.${like}`,
        `shipping_method.ilike.${like}`,
      ];
      if (/^\d+$/.test(qq)) conds.push(`order_number.eq.${qq}`);
      q = q.or(conds.join(","));
    }
  }

  if (params.status && params.status !== "all") {
    q = q.eq("status", params.status as string);
  }

  // Payment status is derived — translate the filter back into order conditions.
  if (params.payment && params.payment !== "all") {
    switch (params.payment) {
      case "paid":
        q = q.eq("status", "paid");
        break;
      case "unpaid":
        q = q.not("status", "in", '("paid","cancelled","returned")');
        break;
      case "awaiting":
        q = q
          .eq("status", "pending")
          .or("payment_method.ilike.%تحويل%,payment_method.ilike.%بنكي%,payment_method.ilike.%transfer%")
          .is("transfer_receipt_url", null);
        break;
      case "refunded":
        q = q.eq("status", "returned");
        break;
      case "cancelled":
        q = q.eq("status", "cancelled");
        break;
    }
  }

  if (params.payment_method && params.payment_method !== "all") {
    if (params.payment_method === "transfer") {
      q = q.or("payment_method.ilike.%تحويل%,payment_method.ilike.%بنكي%,payment_method.ilike.%transfer%");
    } else if (params.payment_method === "cod") {
      q = q.or("payment_method.ilike.%cod%,payment_method.ilike.%عند الاستلام%,payment_method.ilike.%cash on delivery%");
    } else {
      q = q.eq("payment_method", params.payment_method);
    }
  }

  if (params.carrier && params.carrier !== "all") {
    if (params.carrier === "oto") {
      q = q.not("delivery_option_id", "is", null);
    } else if (params.carrier === "none") {
      q = q.is("tracking_number", null).is("carrier_code", null).is("delivery_option_id", null);
    } else {
      q = q.eq("carrier_code", params.carrier);
    }
  }

  if (params.from) {
    const from = new Date(params.from);
    if (!Number.isNaN(from.getTime())) q = q.gte("created_at", from.toISOString());
  }
  if (params.to) {
    const to = new Date(params.to);
    if (!Number.isNaN(to.getTime())) {
      to.setDate(to.getDate() + 1);
      q = q.lt("created_at", to.toISOString());
    }
  }

  return q;
}

function sum(values: (number | null)[] | undefined): number {
  return (values || []).reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
}

async function computeStats(supabase: ReturnType<typeof createAdminClient>): Promise<OrderStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  const [totalRes, todayRes, salesRes, actionRes, returnRes] = await Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }),
    supabase
      .from("orders")
      .select("total,created_at")
      .gte("created_at", todayStart)
      .lt("created_at", tomorrowStart)
      .in("status", ["paid", "delivered"]),
    supabase.from("orders").select("total").in("status", ["paid", "delivered"]),
    supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "confirmed"]),
    supabase.from("orders").select("id", { count: "exact", head: true }).in("status", ["returned", "cancelled"]),
  ]);

  return {
    total: totalRes.count || 0,
    today_orders: todayRes.data?.length || 0,
    today_sales: sum((todayRes.data || []).map((r) => r.total as number)),
    total_sales: sum((salesRes.data || []).map((r) => r.total as number)),
    needs_action: actionRes.count || 0,
    returns_cancelled: returnRes.count || 0,
  };
}

export async function queryOrders(params: OrdersQueryParams): Promise<OrdersQueryResult> {
  const supabase = createAdminClient();
  const limit = params.limit || DEFAULT_LIMIT;
  const page = params.page || 1;

  const countBuilder = buildFiltered(
    supabase,
    params,
    supabase.from("orders").select("id", { count: "exact", head: true })
  );
  const { count } = await countBuilder;
  const total = count || 0;
  const pages = Math.max(1, Math.ceil(total / limit));

  const q = buildFiltered(supabase, params).order(params.sort as string, { ascending: params.dir === "asc" });
  const offset = (page - 1) * limit;
  const { data } = await q.range(offset, offset + limit - 1);

  const [stats] = await Promise.all([computeStats(supabase)]);

  return {
    orders: (data as Order[]) || [],
    total,
    pages,
    page,
    limit,
    stats,
  };
}

export async function exportOrdersCsv(params: OrdersQueryParams): Promise<string> {
  const supabase = createAdminClient();
  const q = buildFiltered(supabase, params);
  const { data } = await q
    .select("*")
    .order("created_at", { ascending: false })
    .limit(CSV_MAX_ROWS);

  const rows = (data as Order[]) || [];

  const headers = [
    "رقم الطلب",
    "العميل",
    "الهاتف",
    "المدينة",
    "حالة الطلب",
    "حالة الدفع",
    "حالة الشحن",
    "الإجمالي",
    "طريقة الدفع",
    "شركة الشحن",
    "رقم التتبع",
    "التاريخ",
  ];

  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = rows.map((o) =>
    [
      o.order_number,
      o.customer_name,
      o.customer_phone,
      o.customer_city,
      ORDER_STATUS_META[o.status]?.label || o.status,
      PAYMENT_STATUS_META[derivePaymentStatus(o)]?.label,
      SHIPPING_STATUS_META[deriveShippingStatus(o)]?.label,
      o.total,
      o.payment_method,
      o.shipping_method,
      o.tracking_number,
      o.created_at,
    ]
      .map(escape)
      .join(",")
  );

  return [headers.map(escape).join(","), ...lines].join("\n");
}

export type { Order };
export { isCod, isTransfer };

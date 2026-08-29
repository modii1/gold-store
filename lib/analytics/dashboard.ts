import { createAdminClient } from "@/lib/supabase/admin";
import type { AnalyticsDashboard, AnalyticsKpis, KpiComparison, TopProduct, SourceBreakdown, DeviceBreakdown, SeriesPoint, Funnel } from "../analytics/types";

const SALE_STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "paid"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shiftDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export async function getDashboard(range: "today" | "7d" | "30d" = "7d"): Promise<AnalyticsDashboard> {
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const now = new Date();
  const todayStart = startOfDay(now);
  const currentStart = shiftDays(todayStart, -(days - 1));
  const previousStart = shiftDays(currentStart, -days);
  const currentStartIso = currentStart.toISOString();
  const previousStartIso = previousStart.toISOString();

  const supabase = createAdminClient();

  // ---- Analytics events (may not exist until migration-016 is applied) ----
  let eventsEnabled = true;
  let currentEvents: {
    id: string;
    visitor_id: string;
    session_id: string;
    event_type: string;
    page_path: string | null;
    product_id: string | null;
    product_slug: string | null;
    referrer: string | null;
    device_type: string | null;
    created_at: string;
  }[] = [];
  let previousEvents: typeof currentEvents = [];
  try {
    const cur = await supabase
      .from("analytics_events")
      .select("id, visitor_id, session_id, event_type, page_path, product_id, product_slug, referrer, device_type, created_at")
      .gte("created_at", currentStartIso)
      .limit(20000);
    if (cur.error) throw cur.error;
    currentEvents = (cur.data as typeof currentEvents) || [];

    const prev = await supabase
      .from("analytics_events")
      .select("id, visitor_id, event_type, created_at")
      .gte("created_at", previousStartIso)
      .lt("created_at", currentStartIso)
      .limit(20000);
    if (prev.error) throw prev.error;
    const prevAny = (prev.data as typeof currentEvents) || [];
    previousEvents = prevAny.map((e) => ({ ...e, session_id: "", page_path: null, product_id: null, product_slug: null, referrer: null, device_type: null }));
  } catch {
    eventsEnabled = false;
  }

  // ---- Orders (authoritative for sales/orders) ----
  let currentOrders: { id: string; status: string; total: number; created_at: string; items: { product_id?: string | number; qty?: number; price?: number }[] }[] = [];
  let previousOrders: typeof currentOrders = [];
  try {
    const cur = await supabase
      .from("orders")
      .select("id, status, total, created_at, items")
      .gte("created_at", currentStartIso)
      .limit(20000);
    if (!cur.error) currentOrders = (cur.data as typeof currentOrders) || [];

    const prev = await supabase
      .from("orders")
      .select("id, status, total, created_at")
      .gte("created_at", previousStartIso)
      .lt("created_at", currentStartIso)
      .limit(20000);
    if (!prev.error) previousOrders = (prev.data as typeof previousOrders) || [];
  } catch {
    /* ignore */
  }

  const saleOrdersCur = currentOrders.filter((o) => SALE_STATUSES.includes(o.status));
  const saleOrdersPrev = previousOrders.filter((o) => SALE_STATUSES.includes(o.status));

  const salesCur = saleOrdersCur.reduce((s, o) => s + (o.total || 0), 0);
  const salesPrev = saleOrdersPrev.reduce((s, o) => s + (o.total || 0), 0);
  const ordersCur = saleOrdersCur.length;
  const ordersPrev = saleOrdersPrev.length;

  const productsWithViews = new Map<string, number>();
  const productsUniqueViewers = new Map<string, Set<string>>();
  const productsWithCarts = new Map<string, number>();
  const funnelCounts = { pageViews: 0, productViews: 0, addToCarts: 0, checkoutStarts: 0, purchases: 0 };
  const sessionsCur = new Set<string>();
  const visitorsSetCur = new Set<string>();
  const visitorsSetPrev = new Set<string>();

  for (const e of currentEvents) {
    sessionsCur.add(e.session_id);
    visitorsSetCur.add(e.visitor_id);
    if (e.event_type === "page_view") funnelCounts.pageViews++;
    else if (e.event_type === "product_view") {
      funnelCounts.productViews++;
      if (e.product_id) {
        productsWithViews.set(e.product_id, (productsWithViews.get(e.product_id) || 0) + 1);
        if (!productsUniqueViewers.has(e.product_id)) productsUniqueViewers.set(e.product_id, new Set());
        productsUniqueViewers.get(e.product_id)!.add(e.visitor_id);
      }
    } else if (e.event_type === "add_to_cart") {
      funnelCounts.addToCarts++;
      if (e.product_id) productsWithCarts.set(e.product_id, (productsWithCarts.get(e.product_id) || 0) + 1);
    } else if (e.event_type === "checkout_start") funnelCounts.checkoutStarts++;
    else if (e.event_type === "purchase") funnelCounts.purchases++;
  }
  for (const e of previousEvents) visitorsSetPrev.add(e.visitor_id);

  const visitorsCur = visitorsSetCur.size;
  const returning = [...visitorsSetCur].filter((v) => visitorsSetPrev.has(v)).length;
  const newVisitors = visitorsCur - returning;

  // ---- Sources & devices — count UNIQUE visitors (one visitor = one) ----
  const sourceVisitors = new Map<string, Set<string>>();
  for (const e of currentEvents) {
    if (e.event_type !== "page_view") continue;
    const src = e.referrer ? referrerLabel(e.referrer) : "مباشر";
    if (!sourceVisitors.has(src)) sourceVisitors.set(src, new Set());
    sourceVisitors.get(src)!.add(e.visitor_id);
  }
  const sources: SourceBreakdown[] = [];
  for (const [label, visitors] of sourceVisitors) sources.push({ label, count: visitors.size });
  sources.sort((a, b) => b.count - a.count);

  const deviceVisitors = new Map<string, Set<string>>();
  for (const e of currentEvents) {
    const d = e.device_type || "desktop";
    if (!deviceVisitors.has(d)) deviceVisitors.set(d, new Set());
    deviceVisitors.get(d)!.add(e.visitor_id);
  }
  const devices: DeviceBreakdown[] = [];
  for (const [device, visitors] of deviceVisitors) devices.push({ device, count: visitors.size });
  devices.sort((a, b) => b.count - a.count);

  // ---- Top products (views from events; sales/orders from order items) ----
  const orderCountByProduct = new Map<string, { orders: number; qty: number; sales: number }>();
  for (const o of saleOrdersCur) {
    const seen = new Set<string>();
    for (const it of o.items || []) {
      const pid = String(it.product_id ?? "");
      if (!pid) continue;
      const rec = orderCountByProduct.get(pid) || { orders: 0, qty: 0, sales: 0 };
      if (!seen.has(pid)) rec.orders++;
      seen.add(pid);
      rec.qty += it.qty || 0;
      rec.sales += (it.price || 0) * (it.qty || 0);
      orderCountByProduct.set(pid, rec);
    }
  }

  const topProducts: TopProduct[] = [];
  const productIds = new Set([...productsWithViews.keys(), ...orderCountByProduct.keys()]);
  if (productIds.size > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, slug, price, images")
      .in("id", [...productIds].filter(Boolean))
      .limit(500);
    const prodMap = new Map<string, { id: string; name: string; slug: string; price: number; image: string | null }>();
    for (const p of (prods as { id: string; name: string; slug: string; price: number; images: unknown }[]) || []) {
      const images = (p.images as { url?: string }[] | null) || [];
      prodMap.set(p.id, {
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: Number(p.price) || 0,
        image: (images[0] as { url?: string } | undefined)?.url || null,
      });
    }
    for (const pid of productIds) {
      const meta = prodMap.get(pid);
      if (!meta) continue;
      const views = productsWithViews.get(pid) || 0;
      const uniqueViews = productsUniqueViewers.get(pid)?.size || 0;
      const carts = productsWithCarts.get(pid) || 0;
      const salesRec = orderCountByProduct.get(pid) || { orders: 0, qty: 0, sales: 0 };
      const conversion = uniqueViews > 0 ? Math.round((salesRec.orders / uniqueViews) * 1000) / 10 : 0;
      topProducts.push({ ...meta, views, uniqueViews, carts, orders: salesRec.orders, qty: salesRec.qty, sales: salesRec.sales, conversion });
    }
  }
  const byViews = [...topProducts].sort((a, b) => b.uniqueViews - a.uniqueViews).slice(0, 10);
  const bySales = [...topProducts].sort((a, b) => b.sales - a.sales).slice(0, 10);
  const byOrders = [...topProducts].sort((a, b) => b.orders - a.orders).slice(0, 10);
  const byConversion = [...topProducts].sort((a, b) => b.conversion - a.conversion).slice(0, 10);
  const highViewLowPurchase = [...topProducts]
    .filter((p) => p.uniqueViews >= 5 && p.orders === 0)
    .sort((a, b) => b.uniqueViews - a.uniqueViews)
    .slice(0, 10);

  // ---- Abandoned carts: visitor added to cart but never checked out/purchased ----
  const cartVisitors = new Set<string>();
  const checkoutOrPurchaseVisitors = new Set<string>();
  for (const e of currentEvents) {
    if (e.event_type === "add_to_cart") cartVisitors.add(e.visitor_id);
    if (e.event_type === "checkout_start" || e.event_type === "purchase") checkoutOrPurchaseVisitors.add(e.visitor_id);
  }
  let abandonedCarts = 0;
  for (const v of cartVisitors) if (!checkoutOrPurchaseVisitors.has(v)) abandonedCarts++;

  // ---- Time series ----
  const seriesStart = shiftDays(todayStart, -(days - 1));
  const series: SeriesPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = shiftDays(seriesStart, i);
    const next = shiftDays(day, 1);
    const key = day.toISOString().slice(0, 10);
    const dayOrders = saleOrdersCur.filter((o) => new Date(o.created_at) >= day && new Date(o.created_at) < next);
    const dayVisitors = new Set(
      currentEvents.filter((e) => e.event_type === "page_view" && new Date(e.created_at) >= day && new Date(e.created_at) < next).map((e) => e.visitor_id)
    );
    const dayViews = currentEvents.filter((e) => e.event_type === "page_view" && new Date(e.created_at) >= day && new Date(e.created_at) < next).length;
    series.push({
      label: key,
      orders: dayOrders.length,
      sales: dayOrders.reduce((s, o) => s + (o.total || 0), 0),
      visitors: dayVisitors.size,
      views: dayViews,
    });
  }

  const aovCur = ordersCur > 0 ? salesCur / ordersCur : 0;
  const aovPrev = ordersPrev > 0 ? salesPrev / ordersPrev : 0;
  const conversionCur = visitorsCur > 0 ? (ordersCur / visitorsCur) * 100 : 0;
  const conversionPrev = visitorsSetPrev.size > 0 ? (ordersPrev / visitorsSetPrev.size) * 100 : 0;

  let uniqueProductViews = 0;
  for (const set of productsUniqueViewers.values()) uniqueProductViews += set.size;

  const kpis: AnalyticsKpis = {
    visitorsNow: sessionsCur.size,
    visitorsToday: visitorsCur,
    productViews: funnelCounts.productViews,
    uniqueProductViews,
    addToCarts: funnelCounts.addToCarts,
    orders: ordersCur,
    sales: salesCur,
    aov: aovCur,
    conversion: conversionCur,
  };

  const comparison: KpiComparison = {
    visitorsToday: compare(visitorsCur, visitorsSetPrev.size),
    orders: compare(ordersCur, ordersPrev),
    sales: compare(salesCur, salesPrev),
    aov: compare(aovCur, aovPrev),
    conversion: compare(conversionCur, conversionPrev),
  };

  const funnel: Funnel = {
    pageViews: eventsEnabled ? funnelCounts.pageViews : 0,
    productViews: eventsEnabled ? funnelCounts.productViews : 0,
    addToCarts: eventsEnabled ? funnelCounts.addToCarts : 0,
    checkoutStarts: eventsEnabled ? funnelCounts.checkoutStarts : 0,
    purchases: eventsEnabled ? funnelCounts.purchases : ordersCur,
    abandonedCarts: eventsEnabled ? abandonedCarts : 0,
  };

  return {
    range,
    kpis,
    comparison,
    series,
    funnel,
    topProducts: { byViews, bySales, byOrders, byConversion },
    highViewLowPurchase,
    sources,
    devices,
    newVsReturning: { new: newVisitors, returning, total: visitorsCur },
    eventsEnabled,
  };
}

function compare(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function referrerLabel(ref: string): string {
  try {
    const parsed = new URL(ref);
    if (parsed.hostname.includes("google")) return "Google";
    if (parsed.hostname.includes("instagram")) return "Instagram";
    if (parsed.hostname.includes("facebook") || parsed.hostname.includes("fb.")) return "Facebook";
    if (parsed.hostname.includes("tiktok")) return "TikTok";
    if (parsed.hostname.includes("whatsapp")) return "WhatsApp";
    if (parsed.hostname.includes("twitter") || parsed.hostname.includes("x.com")) return "X / Twitter";
    if (parsed.hostname.includes("snapchat")) return "Snapchat";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return ref;
  }
}

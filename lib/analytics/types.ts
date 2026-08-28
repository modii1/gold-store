export type Range = "today" | "7d" | "30d";

export type AnalyticsKpis = {
  visitorsNow: number;
  visitorsToday: number;
  productViews: number;
  uniqueProductViews: number;
  addToCarts: number;
  orders: number;
  sales: number;
  aov: number;
  conversion: number;
};

export type KpiComparison = {
  visitorsToday: number | null;
  orders: number | null;
  sales: number | null;
  aov: number | null;
  conversion: number | null;
};

export type SeriesPoint = {
  label: string;
  orders: number;
  sales: number;
  visitors: number;
  views: number;
};

export type Funnel = {
  pageViews: number;
  productViews: number;
  addToCarts: number;
  checkoutStarts: number;
  purchases: number;
  abandonedCarts: number;
};

export type TopProduct = {
  id: string;
  name: string;
  slug: string;
  price: number;
  image: string | null;
  views: number;
  uniqueViews: number;
  carts: number;
  orders: number;
  qty: number;
  sales: number;
  conversion: number;
};

export type SourceBreakdown = { label: string; count: number };

export type DeviceBreakdown = { device: string; count: number };

export type NewVsReturning = { new: number; returning: number; total: number };

export type AnalyticsDashboard = {
  range: Range;
  kpis: AnalyticsKpis;
  comparison: KpiComparison;
  series: SeriesPoint[];
  funnel: Funnel;
  topProducts: {
    byViews: TopProduct[];
    bySales: TopProduct[];
    byOrders: TopProduct[];
    byConversion: TopProduct[];
  };
  highViewLowPurchase: TopProduct[];
  sources: SourceBreakdown[];
  devices: DeviceBreakdown[];
  newVsReturning: NewVsReturning;
  eventsEnabled: boolean;
};

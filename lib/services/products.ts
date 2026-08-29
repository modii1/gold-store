import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Product, Category, Brand } from "@/types";

export type ProductSort = "newest" | "best" | "price_asc" | "price_desc";

export type ProductQuery = {
  category?: string;
  brand?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  karat?: string | string[];
  material?: string | string[];
  color?: string | string[];
  size?: string | string[];
  inStock?: boolean;
  onSale?: boolean;
  featured?: boolean;
  q?: string;
  sort?: ProductSort;
  page?: number;
  perPage?: number;
};

function applyMulti<T extends object>(builder: T, field: string, value: string | string[] | undefined, fn: (v: string[]) => T): T {
  if (!value) return builder;
  const list = Array.isArray(value) ? value : [value];
  return list.length === 1 ? fn(list) : (builder as any).in(field, list);
}

export type ProductResult = {
  products: Product[];
  total: number;
};

const PAGE_SIZE = 24;

export async function getProducts(query: ProductQuery = {}): Promise<ProductResult> {
  const supabase = await createClient();
  const page = Math.max(1, query.page || 1);
  const perPage = query.perPage || PAGE_SIZE;

  let builder = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("is_available", true);

  if (query.q) {
    builder = builder.or(`name.ilike.%${query.q}%,sku.ilike.%${query.q}%,brand.ilike.%${query.q}%,category.ilike.%${query.q}%`);
  }
  if (query.category) builder = builder.eq("category", query.category);
  builder = applyMulti(builder as any, "brand", query.brand, (list) => (builder as any).in("brand", list));
  builder = applyMulti(builder as any, "karat", query.karat, (list) => (builder as any).in("karat", list));
  builder = applyMulti(builder as any, "material", query.material, (list) => (builder as any).in("material", list));
  // color filter â€” variant-aware: match products.color OR any variant color
  if (query.color) {
    const colorList = Array.isArray(query.color) ? query.color : [query.color];
    try {
      const admin = createAdminClient();
      const { data: vRows } = await admin.from("product_variants").select("product_id").in("color", colorList).eq("is_active", true);
      const variantIds = (vRows || []).map((r: any) => r.product_id);
      if (variantIds.length) {
        // products where base color matches OR id in variantIds
        const idsOr = variantIds.map((id: string) => `id.eq.${id}`).join(",");
        // Use or with color filter + variant ids
        // Fallback: if variantIds found, broaden to include them
        builder = (builder as any).or(`color.in.(${colorList.join(",")}),${idsOr}`);
      } else {
        builder = applyMulti(builder as any, "color", query.color, (list) => (builder as any).in("color", list));
      }
    } catch {
      builder = applyMulti(builder as any, "color", query.color, (list) => (builder as any).in("color", list));
    }
  }
  if (query.size) {
    const sizeList = Array.isArray(query.size) ? query.size : [query.size];
    try {
      const admin = createAdminClient();
      const { data: sRows } = await admin.from("product_variants").select("product_id").in("size", sizeList).eq("is_active", true);
      const variantIds = (sRows || []).map((r: any) => r.product_id).filter((id: any) => !!id);
      if (variantIds.length) {
        const idsOr = variantIds.map((id: string) => `id.eq.${id}`).join(",");
        builder = (builder as any).or(idsOr);
      } else {
        builder = (builder as any).in("id", []);
      }
    } catch {
      builder = (builder as any).in("id", []);
    }
  }
  if (query.inStock) builder = builder.gt("stock", 0);
  if (query.onSale) builder = builder.gt("sale_price", 0);
  if (query.featured) builder = builder.eq("featured", true);
  if (typeof query.minPrice === "number") builder = builder.gte("sale_price", query.minPrice).or(`price.gte.${query.minPrice}`);
  if (typeof query.maxPrice === "number") builder = builder.lte("price", query.maxPrice);

  switch (query.sort || "newest") {
    case "best":
      builder = builder.order("is_best_seller", { ascending: false }).order("created_at", { ascending: false });
      break;
    case "price_asc":
      builder = builder.order("price", { ascending: true });
      break;
    case "price_desc":
      builder = builder.order("price", { ascending: false });
      break;
    default:
      builder = builder.order("created_at", { ascending: false });
  }

  builder = builder.range((page - 1) * perPage, page * perPage - 1);

  const { data, count, error } = await builder;
  if (error) return { products: [], total: 0 };
  const products = (data as Product[]) || [];
  // attach variant colors for card dots (Amazon style) â€” bulk fetch
  try {
    const ids = products.map((p) => p.id);
    if (ids.length) {
      const { data: vRows } = await createAdminClient().from("product_variants").select("product_id, color, color_hex, size, stock").in("product_id", ids).eq("is_active", true);
      const map = new Map<string, any[]>();
      (vRows || []).forEach((r: any) => {
        const arr = map.get(r.product_id) || [];
        arr.push(r);
        map.set(r.product_id, arr);
      });
      for (const p of products) {
        const v = map.get(p.id);
        if (v?.length) (p as any).variants = v;
      }
    }
  } catch {}
  return { products, total: count ?? 0 };
}

export async function getProduct(slug: string): Promise<Product | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("products").select("*").eq("slug", slug).maybeSingle();
    if (!data) return null;
    const product = data as Product;
    try {
      const admin = createAdminClient();
      const { data: variants } = await admin.from("product_variants").select("*").eq("product_id", product.id).eq("is_active", true).order("sort_order");
      if (variants?.length) (product as any).variants = variants;
      // الصور تُحفظ مرتبة من لوحة التحكم (الأول = الغلاف) — نحافظ على الترتيب لمنع إعادة ترتيب توليفات قبل العامة.
      const ordered = (product.images || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
      // إلحاق صور التوليفات التي قد تُفقد من المعرض (منتجات قديمة) مع الحفاظ على ترتيبها.
      const extra = (variants || []).filter((v: any) => v.image_url).map((v: any) => ({ url: v.image_url, caption: v.color || "" }));
      const seen = new Set<string>();
      (product as any).images = [...ordered, ...extra].filter((m: any) => {
        if (seen.has(m.url)) return false;
        seen.add(m.url);
        return true;
      });
    } catch {}
    return product;
  } catch {
    return null;
  }
}

export async function getProductById(id: string): Promise<Product | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
    return (data as Product) || null;
  } catch {
    return null;
  }
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("featured", true)
      .eq("is_available", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    const products = (data as Product[]) || [];
    try { const ids = products.map((p) => p.id); if (ids.length) { const { data: vRows } = await createAdminClient().from("product_variants").select("product_id, color, color_hex, size, stock").in("product_id", ids).eq("is_active", true); const map = new Map<string, any[]>(); (vRows || []).forEach((r: any) => { const a = map.get(r.product_id) || []; a.push(r); map.set(r.product_id, a); }); for (const p of products) { const v = map.get(p.id); if (v?.length) (p as any).variants = v; } } } catch {}
    return products;
  } catch {
    return [];
  }
}

export async function getBestSellers(limit = 8): Promise<Product[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_best_seller", true)
      .eq("is_available", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    const products = (data as Product[]) || [];
    try { const ids = products.map((p) => p.id); if (ids.length) { const { data: vRows } = await createAdminClient().from("product_variants").select("product_id, color, color_hex, size, stock").in("product_id", ids).eq("is_active", true); const map = new Map<string, any[]>(); (vRows || []).forEach((r: any) => { const a = map.get(r.product_id) || []; a.push(r); map.set(r.product_id, a); }); for (const p of products) { const v = map.get(p.id); if (v?.length) (p as any).variants = v; } } } catch {}
    return products;
  } catch {
    return [];
  }
}

export async function getLatestProducts(limit = 8): Promise<Product[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_available", true)
      .order("created_at", { ascending: false })
      .limit(limit);
    const products = (data as Product[]) || [];
    try { const ids = products.map((p) => p.id); if (ids.length) { const { data: vRows } = await createAdminClient().from("product_variants").select("product_id, color, color_hex, size, stock").in("product_id", ids).eq("is_active", true); const map = new Map<string, any[]>(); (vRows || []).forEach((r: any) => { const a = map.get(r.product_id) || []; a.push(r); map.set(r.product_id, a); }); for (const p of products) { const v = map.get(p.id); if (v?.length) (p as any).variants = v; } } } catch {}
    return products;
  } catch {
    return [];
  }
}

export async function getOnSaleProducts(limit = 8): Promise<Product[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("is_available", true)
      .gt("sale_price", 0)
      .order("created_at", { ascending: false })
      .limit(limit);
    const products = (data as Product[]) || [];
    try { const ids = products.map((p) => p.id); if (ids.length) { const { data: vRows } = await createAdminClient().from("product_variants").select("product_id, color, color_hex, size, stock").in("product_id", ids).eq("is_active", true); const map = new Map<string, any[]>(); (vRows || []).forEach((r: any) => { const a = map.get(r.product_id) || []; a.push(r); map.set(r.product_id, a); }); for (const p of products) { const v = map.get(p.id); if (v?.length) (p as any).variants = v; } } } catch {}
    return products;
  } catch {
    return [];
  }
}

export async function getCategoriesList(): Promise<Category[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    return (data as Category[]) || [];
  } catch {
    return [];
  }
}

export async function getBrandsList(): Promise<Brand[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("brands").select("*").eq("is_active", true).order("name");
    return (data as Brand[]) || [];
  } catch {
    return [];
  }
}

export async function getFacetValues(column: "karat" | "material" | "color" | "brand" | "size"): Promise<string[]> {
  try {
    const supabase = await createClient();
    const set = new Set<string>();
    if (column === "color" || column === "size") {
      const field = column === "color" ? "color" : "size";
      const { data: vData } = await createAdminClient().from("product_variants").select(field).eq("is_active", true).not(field, "is", null);
      (vData || []).forEach((r: any) => {
        const v = r[field] as string;
        if (typeof v === "string" && v.trim()) set.add(v.trim());
      });
      return Array.from(set).slice(0, 30);
    }
    const { data } = await supabase
      .from("products")
      .select(column)
      .eq("is_available", true)
      .not(column, "is", null);
    (data || []).forEach((r) => {
      const v = (r as Record<string, unknown>)[column];
      if (typeof v === "string") {
        set.add(v);
      }
    });
    return Array.from(set).slice(0, 30);
  } catch {
    return [];
  }
}

export async function getProductStats(productId: string): Promise<{ rating: number; count: number }> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("reviews").select("rating").eq("product_id", productId).eq("is_active", true);
    const list = (data as { rating: number }[]) || [];
    if (list.length === 0) return { rating: 0, count: 0 };
    const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
    return { rating: Math.round(avg * 10) / 10, count: list.length };
  } catch {
    return { rating: 0, count: 0 };
  }
}

export async function getRelatedProducts(product: Product, limit = 4): Promise<Product[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("category", product.category)
      .eq("is_available", true)
      .neq("id", product.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as Product[]) || [];
  } catch {
    return [];
  }
}

export type SearchResult = {
  id: string;
  name: string;
  slug: string;
  price: number;
  sale_price: number | null;
  image: string | null;
  category: string | null;
  sku: string | null;
};

export async function searchProducts(q: string, limit = 12): Promise<SearchResult[]> {
  if (!q.trim()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("products")
      .select("id, name, slug, price, sale_price, category, sku, images")
      .eq("is_available", true)
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%,brand.ilike.%${q}%,category.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as any[]) || []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: r.price,
      sale_price: r.sale_price,
      category: r.category,
      sku: r.sku,
      image: r.images?.[0]?.url ?? null,
    }));
  } catch {
    return [];
  }
}



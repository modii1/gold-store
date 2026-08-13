import { createClient } from "@/lib/supabase/server";

export default async function sitemap() {
  const base = "https://motali.vercel.app";
  const supabase = await createClient();

  const staticUrls = [
    { url: base, lastModified: new Date(), priority: 1 },
    { url: `${base}/shop`, lastModified: new Date(), priority: 0.9 },
    { url: `${base}/account`, lastModified: new Date(), priority: 0.4 },
    { url: `${base}/favorites`, lastModified: new Date(), priority: 0.4 },
    { url: `${base}/checkout`, lastModified: new Date(), priority: 0.3 },
  ];

  let productUrls: { url: string; lastModified: Date; priority: number }[] = [];
  let categoryUrls: { url: string; lastModified: Date; priority: number }[] = [];
  let pageUrls: { url: string; lastModified: Date; priority: number }[] = [];

  try {
    const { data: products } = await supabase.from("products").select("slug, updated_at, created_at").eq("is_available", true).limit(1000);
    productUrls = (products || []).map((p) => ({
      url: `${base}/product/${p.slug}`,
      lastModified: new Date(p.updated_at || p.created_at || Date.now()),
      priority: 0.7,
    }));
  } catch {}

  try {
    const { data: categories } = await supabase.from("categories").select("slug").eq("is_active", true);
    categoryUrls = (categories || []).map((c) => ({
      url: `${base}/category/${c.slug}`,
      lastModified: new Date(),
      priority: 0.6,
    }));
  } catch {}

  try {
    const { data: pages } = await supabase.from("pages").select("slug").eq("is_active", true);
    pageUrls = (pages || []).map((p) => ({
      url: `${base}/pages/${p.slug}`,
      lastModified: new Date(),
      priority: 0.5,
    }));
  } catch {}

  return [...staticUrls, ...categoryUrls, ...productUrls, ...pageUrls];
}

"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Product } from "@/types";

type CsvRow = Record<string, string>;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `product-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.toLowerCase().trim());
  return rows.slice(1).map((r) => {
    const obj: CsvRow = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] || ""; });
    return obj;
  });
}

const num = (v: string | undefined) => {
  const n = parseFloat(v || "");
  return isNaN(n) ? null : n;
};

export async function importProductsCsvAction(formData: FormData) {
  const file = formData.get("file") as File | null;
  if (!file) return { error: "اختر ملف CSV" };

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return { error: "الملف فارغ أو صيغته غير صحيحة" };

  const supabase = createAdminClient();
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const [index, r] of rows.entries()) {
    const name = r["name"] || r["الاسم"];
    if (!name) { errors.push(`صف ${index + 2}: لا يوجد اسم`); continue; }
    const price = num(r["price"] || r["السعر"]);
    if (!price || price <= 0) { errors.push(`صف ${index + 2}: السعر غير صالح`); continue; }

    const sku = r["sku"] || r["كود"];
    const payload = {
      name,
      slug: r["slug"] || slugify(name),
      price,
      sale_price: num(r["sale_price"] || r["سعر الخصم"]),
      sku: sku || null,
      barcode: r["barcode"] || null,
      category: r["category"] || r["الفئة"] || null,
      brand: r["brand"] || r["العلامة"] || null,
      weight: r["weight"] || r["الوزن"] || null,
      karat: r["karat"] || r["العيار"] || null,
      material: r["material"] || r["المادة"] || null,
      color: r["color"] || r["اللون"] || null,
      stock: parseInt(r["stock"] || r["الكمية"] || "0") || 0,
      description: r["description"] || r["الوصف"] || null,
      is_available: (r["is_available"] || "true").toLowerCase() !== "false",
      featured: (r["featured"] || "").toLowerCase() === "true",
      is_best_seller: (r["is_best_seller"] || r["الأكثر مبيعاً"] || "").toLowerCase() === "true",
      images: r["images"] ? r["images"].split(";").filter(Boolean).map((url) => ({ url: url.trim() })) : [],
      videos: r["videos"] ? r["videos"].split(";").filter(Boolean).map((url) => ({ url: url.trim() })) : [],
    };

    if (sku) {
      const { data: existing } = await supabase.from("products").select("id").eq("sku", sku).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("products").update(payload).eq("id", existing.id);
        if (error) errors.push(`صف ${index + 2}: ${error.message}`);
        else updated++;
        continue;
      }
    }

    const { error } = await supabase.from("products").insert(payload);
    if (error) errors.push(`صف ${index + 2}: ${error.message}`);
    else created++;
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  return { success: true, created, updated, errors };
}

export async function deleteAllProductsAction(formData: FormData) {
  const confirmText = (formData.get("confirm") as string) || "";
  if (confirmText !== "حذف الكل") return { error: 'اكتب "حذف الكل" لتأكيد الحذف' };

  const supabase = createAdminClient();
  const { error } = await supabase.from("products").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) return { error: error.message };
  revalidatePath("/admin/products");
  revalidatePath("/");
  return { success: true };
}

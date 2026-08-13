"use server";

import { searchProducts } from "@/lib/services/products";

export async function searchProductsAction(q: string) {
  return searchProducts(q);
}

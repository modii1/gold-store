"use client";

import { useEffect, useRef } from "react";
import { useAnalytics } from "@/lib/analytics/client";

/**
 * Fires a `product_view` event once per product page mount.
 * Mounted from the (server) product detail page.
 */
export function ProductViewTracker({ productId, slug }: { productId: string; slug: string }) {
  const { trackProductView } = useAnalytics();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackProductView(productId, slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, slug]);

  return null;
}

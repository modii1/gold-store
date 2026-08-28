"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics/client";

/**
 * Fires a `page_view` event whenever the browser path changes.
 * Mounted once in the root layout.
 */
export function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Ignore admin panel — internal traffic shouldn't pollute storefront analytics.
    if (pathname.startsWith("/admin")) return;
    trackEvent({ event: "page_view", page_path: window.location.pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}

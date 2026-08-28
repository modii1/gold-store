"use client";

/**
 * Lightweight client-side analytics tracker.
 *
 * Maintains an anonymous `visitor_id` (persisted ~90 days) and a per-page-session
 * `session_id` in localStorage/sessionStorage. Fires fire-and-forget events to the
 * `/api/analytics/track` endpoint. No personal data is collected — only anonymous
 * IDs, page path, optional product id/slug, referrer, and device type.
 */

const VISITOR_KEY = "gs_visitor";
const SESSION_KEY = "gs_session";
const VISITOR_TTL = 90 * 24 * 60 * 60 * 1000;

export type AnalyticEventType =
  | "page_view"
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "checkout_start"
  | "purchase";

type TrackPayload = {
  event: AnalyticEventType;
  page_path?: string;
  product_id?: string | null;
  product_slug?: string | null;
  metadata?: Record<string, unknown>;
};

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getVisitorId(): string {
  try {
    const now = Date.now();
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed?.id && now - parsed.at < VISITOR_TTL) return parsed.id;
      } catch {
        /* re-create below */
      }
    }
    const id = randomId();
    window.localStorage.setItem(VISITOR_KEY, JSON.stringify({ id, at: now }));
    return id;
  } catch {
    return "anon";
  }
}

function getSessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = randomId();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

function getDeviceType(): "mobile" | "tablet" | "desktop" {
  try {
    const ua = navigator.userAgent;
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
    return "desktop";
  } catch {
    return "desktop";
  }
}

let queue: TrackPayload[] = [];
let flushing = false;

function flush() {
  if (flushing || queue.length === 0) return;
  const batch = queue;
  queue = [];
  flushing = true;
  fetch("/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: batch }),
    keepalive: true,
  })
    .catch(() => {
      // best-effort; drop on failure
    })
    .finally(() => {
      flushing = false;
      if (queue.length > 0) flush();
    });
}

function enqueue(envelope: ReturnType<typeof buildAnalyticsEnvelope>) {
  queue.push(envelope as unknown as TrackPayload);
  flush();
}

export function trackEvent(payload: TrackPayload) {
  if (typeof window === "undefined") return;
  try {
    enqueue(buildAnalyticsEnvelope(payload));
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget from the current page (client components only). */
export function useAnalytics() {
  return {
    track: trackEvent,
    trackProductView: (productId: string, slug: string) =>
      trackEvent({ event: "product_view", product_id: productId, product_slug: slug }),
    trackAddToCart: (productId: string, slug?: string | null, qty?: number) =>
      trackEvent({ event: "add_to_cart", product_id: productId, product_slug: slug || undefined, metadata: { qty } }),
    trackRemoveFromCart: (productId: string) =>
      trackEvent({ event: "remove_from_cart", product_id: productId }),
    trackCheckoutStart: () => trackEvent({ event: "checkout_start" }),
    trackPurchase: (value: number) =>
      trackEvent({ event: "purchase", metadata: { value } }),
  };
}

/** Builds the full server-side event envelope (visitor, session, device). */
export function buildAnalyticsEnvelope(payload: TrackPayload): Record<string, unknown> & { visitor_id: string; session_id: string; event_type: string } {
  return {
    visitor_id: getVisitorId(),
    session_id: getSessionId(),
    event_type: payload.event,
    page_path: payload.page_path ?? (typeof window !== "undefined" ? window.location.pathname : ""),
    product_id: payload.product_id ?? null,
    product_slug: payload.product_slug ?? null,
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
    device_type: getDeviceType(),
    metadata: payload.metadata ?? {},
  };
}

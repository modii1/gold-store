import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

export async function getAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get("admin_session")?.value === "ok";
}

export async function setAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set("admin_session", "ok", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 12,
    path: "/",
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set("admin_session", "", { maxAge: 0, path: "/" });
}

// ---------- CUSTOMER SESSION (HMAC-signed token cookie) ----------

export type CustomerSession = {
  id: string;
  name: string;
  phone: string;
  exp: number;
};

function sessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "gold-store-dev-secret";
}

function signCustomerToken(payload: Omit<CustomerSession, "exp"> & { exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyCustomerToken(token: string): CustomerSession | null {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as CustomerSession;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (!payload.id || !payload.name || !payload.phone) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("customer_session")?.value;
  return token ? verifyCustomerToken(token) : null;
}

export async function setCustomerSession(customer: { id: string; name: string; phone: string }) {
  const cookieStore = await cookies();
  const token = signCustomerToken({ ...customer, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 });
  cookieStore.set("customer_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function clearCustomerSession() {
  const cookieStore = await cookies();
  cookieStore.set("customer_session", "", { maxAge: 0, path: "/" });
}

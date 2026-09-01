import { getAdminSession, getCustomerSession } from "@/lib/auth";

export type Viewer = {
  userType: "admin" | "customer";
  userId: string;
  customerId?: string;
};

/**
 * Resolve who is viewing notifications. Admins see all admin notifications
 * (all roles); customers see only their own.
 *
 * `prefer` breaks ties when a browser holds both an admin and a customer
 * session (e.g. a store owner logged into the admin panel in the same
 * browser that also has a customer login): pages signal their own context
 * via `?as=`, so the customer panel never surfaces admin notifications and
 * the admin panel never downgrades to a customer scope.
 */
export async function getViewer(prefer?: "admin" | "customer"): Promise<Viewer | null> {
  const [admin, customer] = await Promise.all([getAdminSession(), getCustomerSession()]);
  if (prefer === "customer") {
    if (customer) return { userType: "customer", userId: customer.phone, customerId: customer.id };
    if (admin) return { userType: "admin", userId: "admin" };
    return null;
  }
  if (admin) return { userType: "admin", userId: "admin" };
  if (customer) return { userType: "customer", userId: customer.phone, customerId: customer.id };
  return null;
}

export function viewerFilter(viewer: Viewer) {
  if (viewer.userType === "admin") {
    return { user_type: "admin" as const };
  }
  return { user_type: "customer" as const, user_id: viewer.userId };
}

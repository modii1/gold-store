import { getAdminSession, getCustomerSession } from "@/lib/auth";

export type Viewer = {
  userType: "admin" | "customer";
  userId: string;
  customerId?: string;
};

/**
 * Resolve who is viewing notifications. Admins see all admin notifications
 * (all roles); customers see only their own.
 */
export async function getViewer(): Promise<Viewer | null> {
  if (await getAdminSession()) {
    return { userType: "admin", userId: "admin" };
  }
  const customer = await getCustomerSession();
  if (customer) {
    return { userType: "customer", userId: customer.phone, customerId: customer.id };
  }
  return null;
}

export function viewerFilter(viewer: Viewer) {
  if (viewer.userType === "admin") {
    return { user_type: "admin" as const };
  }
  return { user_type: "customer" as const, user_id: viewer.userId };
}

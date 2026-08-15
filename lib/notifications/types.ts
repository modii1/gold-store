export type Severity = "info" | "success" | "warning" | "critical";
export type Category =
  | "orders"
  | "shipping"
  | "payment"
  | "returns"
  | "customer"
  | "system"
  | "security"
  | "webhook"
  | "marketing";

export type UserType = "admin" | "customer";

export type ChannelCode = "in_app" | "email" | "sms" | "push" | "whatsapp";

export type DeliveryStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "permanent_failed"
  | "skipped";

export type EventStatus = "pending" | "processed" | "ignored" | "failed";

export type NotificationRow = {
  id: string;
  user_type: UserType;
  user_id: string;
  customer_id: string | null;
  order_id: string | null;
  order_number: number | null;
  shipment_id: string | null;
  type: string;
  category: Category;
  severity: Severity;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  action_url: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EventInput = {
  source: string;
  externalEventId: string;
  eventType: string;
  orderId?: string | null;
  orderNumber?: number | null;
  shipmentId?: string | null;
  customerIdentifier?: string | null;
  payload?: Record<string, unknown>;
};

export type NotificationTemplate = {
  event_type: string;
  name: string;
  title: string;
  body: string;
  severity: Severity;
  category: Category;
  channels: ChannelCode[];
  is_active: boolean;
};

export type Rule = {
  event_type: string;
  name: string;
  condition: Record<string, unknown>;
  channels: ChannelCode[];
  recipients: string[];
  is_active: boolean;
};

export type DeliveryAttemptResult = {
  ok: boolean;
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  status?: DeliveryStatus;
};

export type ChannelAdapter = {
  code: ChannelCode;
  name: string;
  isConfigured(): Promise<boolean> | boolean;
  send(params: {
    recipient: string;
    title: string;
    message: string;
    variables: Record<string, unknown>;
    notificationId: string;
  }): Promise<DeliveryAttemptResult>;
};

export type TemplateVariables = Record<string, string | number | null | undefined>;

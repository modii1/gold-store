-- migration-021-whatsapp-customer.sql (نسخة مختصرة)
-- تفعيل واتساب للعميل في أحداث الطلبات/الشحن/المرتجعات.
-- العميل يستلم على رقمه المسجل في الطلب، والإدارة على رقمها.

-- 1) تأكد أن قناة واتساب مفعّلة (لا يمسّ config الحالي)
update notification_channels
set enabled = true, updated_at = now()
where code = 'whatsapp' and enabled = false;

-- 2) تحديث قواعد الأحداث: داخل التطبيق + واتساب، ومستقبلون = الإدارة + العميل
update notification_rules r
set
  channels   = case r.event_type
    when 'order.payment_success' then '["in_app","whatsapp","sms"]'::jsonb
    when 'order.payment_failed'  then '["in_app","whatsapp","sms"]'::jsonb
    else '["in_app","whatsapp"]'::jsonb
  end,
  recipients = case r.event_type
    when 'order.payment_success' then '["admin","finance","customer"]'::jsonb
    when 'order.payment_failed'  then '["admin","finance","customer"]'::jsonb
    when 'shipment.out_for_delivery'     then '["admin","shipping_manager","customer"]'::jsonb
    when 'shipment.delivery_failed'      then '["admin","shipping_manager","customer"]'::jsonb
    when 'shipment.failed'               then '["admin","shipping_manager","customer"]'::jsonb
    when 'shipment.on_hold'              then '["admin","shipping_manager","customer"]'::jsonb
    when 'shipment.delayed'              then '["admin","shipping_manager","customer"]'::jsonb
    when 'shipment.stuck'                then '["admin","shipping_manager","customer"]'::jsonb
    when 'shipment.carrier_changed'      then '["admin","shipping_manager","customer"]'::jsonb
    when 'return.refunded'               then '["admin","finance","customer"]'::jsonb
    else '["admin","customer"]'::jsonb
  end,
  updated_at = now()
where r.event_type in (
  'order.created', 'order.status_changed', 'order.payment_success',
  'order.payment_failed', 'order.cancelled',
  'shipment.created', 'shipment.tracking_available', 'shipment.picked_up',
  'shipment.in_transit', 'shipment.out_for_delivery', 'shipment.delivered',
  'shipment.delivery_failed', 'shipment.failed', 'shipment.cancelled',
  'shipment.on_hold', 'shipment.delayed', 'shipment.stuck', 'shipment.carrier_changed',
  'return.requested', 'return.approved', 'return.created', 'return.received',
  'return.refunded', 'return.rejected'
);
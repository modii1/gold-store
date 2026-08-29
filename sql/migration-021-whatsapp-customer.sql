-- migration-021-whatsapp-customer.sql
-- تفعيل إشعارات واتساب للعميل: أحداث الطلبات/الشحن/المرتجعات
-- تُرسل للعميل (على رقمه المسجل في الطلب) ولمديري المتجر، مع بقاء القناة
-- الأساسية "داخل التطبيق". لا يُزفّف أي إعداد حالي مرتبط بـ whatsapp config.
--
-- شغّل هذا الملف كاملًا في Supabase SQL Editor (منفذ يدويًا).

-- 1) تأكد أن قناة واتساب مفعّلة (دون لمس config الحالي الذي فيه bridge_url وغيره)
update notification_channels
set enabled = true, updated_at = now()
where code = 'whatsapp' and enabled = false;

-- 2) تحديث قواعد الأحداث: العميل + الإدارة، داخل التطبيق + واتساب
update notification_rules r
set
  channels  = v.channels,
  recipients = v.recipients,
  updated_at = now()
from (values
  ('order.created',             '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('order.status_changed',      '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('order.payment_success',     '["in_app","whatsapp","sms"]'::jsonb,      '["admin","finance","customer"]'::jsonb),
  ('order.payment_failed',      '["in_app","whatsapp","sms"]'::jsonb,      '["admin","finance","customer"]'::jsonb),
  ('order.cancelled',           '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('shipment.created',          '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('shipment.tracking_available','["in_app","whatsapp"]'::jsonb,           '["admin","customer"]'::jsonb),
  ('shipment.picked_up',        '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('shipment.in_transit',       '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('shipment.out_for_delivery', '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('shipment.delivered',        '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('shipment.delivery_failed',  '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('shipment.failed',           '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('shipment.cancelled',        '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('shipment.on_hold',          '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('shipment.delayed',          '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('shipment.stuck',            '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('shipment.carrier_changed',  '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb),
  ('return.requested',          '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('return.approved',           '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('return.created',            '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('return.received',           '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb),
  ('return.refunded',           '["in_app","whatsapp"]'::jsonb,            '["admin","finance","customer"]'::jsonb),
  ('return.rejected',           '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb)
) as v(event_type, channels, recipients)
where r.event_type = v.event_type;

-- 3) إدراج أي قواعد مفقودة (مناسبت للأماكن التي لم تُزفّر فيها القواعد بعد)
with rows(event_type, name, condition, channels, recipients, is_active, updated_at) as (
  values
  ('order.created',              'طلب جديد',           '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('order.status_changed',       'تحديث حالة الطلب',   '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('order.payment_success',      'تم الدفع',           '{}'::jsonb, '["in_app","whatsapp","sms"]'::jsonb,      '["admin","finance","customer"]'::jsonb, true, now()),
  ('order.payment_failed',       'فشل الدفع',          '{}'::jsonb, '["in_app","whatsapp","sms"]'::jsonb,      '["admin","finance","customer"]'::jsonb, true, now()),
  ('order.cancelled',            'إلغاء الطلب',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.created',           'تم إنشاء الشحنة',    '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.tracking_available','رقم التتبع متاح',    '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.picked_up',         'تم الاستلام',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.in_transit',        'في الطريق',          '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.out_for_delivery',  'خرج للتسليم',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('shipment.delivered',         'تم التسليم',         '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.delivery_failed',   'فشل التسليم',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('shipment.failed',            'فشل إنشاء الشحنة',   '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('shipment.cancelled',         'إلغاء الشحنة',       '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('shipment.on_hold',           'شحنة معلقة',         '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('shipment.delayed',           'شحنة متأخرة',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('shipment.stuck',             'شحنة متوقفة',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('shipment.carrier_changed',   'تغيير شركة الشحن',   '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","shipping_manager","customer"]'::jsonb, true, now()),
  ('return.requested',           'طلب استرجاع',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('return.approved',            'موافقة استرجاع',     '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('return.created',             'شحنة مرتجع',         '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('return.received',            'استلام مرتجع',       '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now()),
  ('return.refunded',            'رد المبلغ',          '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","finance","customer"]'::jsonb, true, now()),
  ('return.rejected',            'رفض استرجاع',        '{}'::jsonb, '["in_app","whatsapp"]'::jsonb,            '["admin","customer"]'::jsonb, true, now())
)
insert into notification_rules (event_type, name, condition, channels, recipients, is_active, updated_at)
select event_type, name, condition, channels, recipients, is_active, updated_at
from rows v
where not exists (select 1 from notification_rules r where r.event_type = v.event_type);
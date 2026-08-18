-- حذف كل الطلبات والبيانات المرتبطة
-- شغّل هذا السكربت من Supabase Dashboard > SQL Editor

-- 1. الإشعارات المرتبطة بالطلبات
DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE order_id IS NOT NULL);
DELETE FROM notifications WHERE order_id IS NOT NULL;
DELETE FROM notification_events WHERE order_id IS NOT NULL;

-- 2. سجل الشحنات
DELETE FROM shipping_logs WHERE order_id IS NOT NULL;

-- 3. الطلبات (يحذف CASCADE: shipments, order_status_log, order_notes, return_requests)
DELETE FROM orders;

SELECT 'تم حذف كل الطلبات والبيانات المرتبطة' AS result;

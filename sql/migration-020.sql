-- إيقاف مؤقت شامل لقنوات الإشعارات (master switch)
-- يشغّله المستخدم من لوحة التحكم ← الإشعارات ← مفتاح "إيقاف مؤقت"
alter table settings add column if not exists notifications_paused boolean not null default false;
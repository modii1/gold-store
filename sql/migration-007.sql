-- gold-store migration 007: add 4th product (temporary, 4 images)
-- Run once in Supabase SQL Editor
insert into products (
  name,
  slug,
  description,
  price,
  sale_price,
  category,
  images,
  is_available,
  featured,
  is_best_seller
) values (
  'منتج تجريبي — طقم ذهبي',
  'temporary-gold-set',
  'منتج تجريبي مؤقت بأربع صور. عدّل البيانات من لوحة التحكم (المنتجات ← تعديل) ثم استبدل الصور من إعدادات المنتج.',
  500,
  450,
  'اكسسوارات',
  '[
    {"url": "https://picsum.photos/seed/gold1/800/800"},
    {"url": "https://picsum.photos/seed/gold2/800/800"},
    {"url": "https://picsum.photos/seed/gold3/800/800"},
    {"url": "https://picsum.photos/seed/gold4/800/800"}
  ]'::jsonb,
  true,
  true,
  false
) on conflict (slug) do nothing;

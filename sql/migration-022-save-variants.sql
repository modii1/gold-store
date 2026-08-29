-- migration-022-save-variants.sql
-- حفظ التوليفات بشكل ذرّي (حذف + إدراج في معاملة واحدة) لضمان عدم ضياع التوليفات
-- لو فشل الإدراج. يُستدعى من السيرفر أكتشن عبر RPC.
--
-- شغّل هذا الملف كاملًا في Supabase SQL Editor.

create or replace function public.save_product_variants(p_product_id uuid, p_variants jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  i int := 0;
  first_color text;
begin
  delete from public.product_variants where product_id = p_product_id;

  if jsonb_typeof(p_variants) <> 'array' then
    return;
  end if;

  for v in select * from jsonb_array_elements(p_variants) loop
    -- مهم: نحتفظ بالتوليفة حتى لو لم يملأ المستخدم لون/مقاس، بشرط أن لها صورة.
    if coalesce(v->>'color', '') <> ''
       or coalesce(v->>'size', '') <> ''
       or coalesce(v->>'image_url', '') <> '' then
      insert into public.product_variants (
        product_id, color, color_hex, size, sku, price, sale_price,
        stock, image_url, sort_order, is_active
      ) values (
        p_product_id,
        nullif(coalesce(v->>'color', ''), ''),
        nullif(coalesce(v->>'color_hex', ''), ''),
        nullif(coalesce(v->>'size', ''), ''),
        nullif(coalesce(v->>'sku', ''), ''),
        case
          when v->>'price' is null or v->>'price' = '' then null
          else (v->>'price')::numeric
        end,
        case
          when v->>'sale_price' is null or v->>'sale_price' = '' then null
          else (v->>'sale_price')::numeric
        end,
        coalesce((v->>'stock')::int, 0),
        nullif(coalesce(v->>'image_url', ''), ''),
        i,
        true
      );
      i := i + 1;
    end if;
  end loop;

  -- مزامنة لون المنتج لأغراض الفلترة (أول لون)
  update public.products
  set color = (
    select pv.color
    from public.product_variants pv
    where pv.product_id = p_product_id
      and pv.color is not null and pv.color <> ''
    order by pv.sort_order
    limit 1
  )
  where id = p_product_id
    and exists (
      select 1 from public.product_variants pv
      where pv.product_id = p_product_id
        and pv.color is not null and pv.color <> ''
    );
end;
$$;

-- لا نسمح للمستخدمين المجهولين/المسجلين باستدعائها (تُستخدم عبر service_role فقط)
revoke execute on function public.save_product_variants(uuid, jsonb) from public;
grant execute on function public.save_product_variants(uuid, jsonb) to service_role;
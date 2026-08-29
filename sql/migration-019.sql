-- ============================================================
-- gold-store migration 019: proof-of-payment receipts storage bucket
-- Run ONCE in Supabase SQL Editor (after migration 018)
--
-- Creates a public storage bucket for customers to upload bank-transfer
-- receipts (إيصال التحويل) at checkout. Public read so admins and the
-- customer can view the uploaded receipt by URL.
-- ============================================================

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Public Read Receipts') then
    create policy "Public Read Receipts" on storage.objects for select using ( bucket_id = 'receipts' );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone Upload Receipts') then
    create policy "Anyone Upload Receipts" on storage.objects for insert with check ( bucket_id = 'receipts' );
  end if;
end $$;

notify pgrst, 'reload schema';

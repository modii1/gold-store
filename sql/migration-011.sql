-- gold-store migration 011: OTO return shipments integration
-- Run once in Supabase SQL Editor

alter table return_requests add column if not exists oto_return_order_id text;
alter table return_requests add column if not exists return_tracking_number text;
alter table return_requests add column if not exists return_tracking_url text;
alter table return_requests add column if not exists return_delivery_company text;
alter table return_requests add column if not exists return_delivery_option_name text;
alter table return_requests add column if not exists return_print_awb_url text;
alter table return_requests add column if not exists return_fee numeric;
alter table return_requests add column if not exists return_status text;
alter table return_requests add column if not exists return_error text;
alter table return_requests add column if not exists return_shipped_at timestamptz;

notify pgrst, 'reload schema';

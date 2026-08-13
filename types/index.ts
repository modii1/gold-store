export type MediaItem = {
  url: string;
  caption?: string;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  sale_price: number | null;
  sku: string | null;
  barcode: string | null;
  weight: string | null;
  karat: string | null;
  material: string | null;
  color: string | null;
  brand: string | null;
  stock: number;
  weight_grams: number | null;
  category: string | null;
  images: MediaItem[];
  videos: MediaItem[];
  is_available: boolean;
  featured: boolean;
  is_best_seller: boolean;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export type Brand = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
};

export type Coupon = {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_order: number;
  ends_at: string | null;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
};

export type ShippingMethod = {
  id: string;
  name: string;
  cost: number;
  free_above: number | null;
  estimated_days: string | null;
};

export type CarrierConfig = {
  apiKey?: string;
  username?: string;
  password?: string;
  accountNumber?: string;
  clientCode?: string;
  endpoint?: string;
  testMode?: boolean;
};

export type Carrier = {
  id: string;
  name: string;
  code: string;
  logo_url: string | null;
  mode: "flat" | "api";
  provider?: "manual" | "oto" | "own_contract";
  delivery_option_id?: number | null;
  service_type?: string | null;
  cost: number;
  free_above: number | null;
  estimated_days: string | null;
  config: CarrierConfig | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

export type PaymentMethod = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
};

export type Banner = {
  id: string;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  mobile_image: string | null;
  cta_text: string | null;
  cta_link: string | null;
};

export type OrderItem = {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  image?: string | null;
};

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "paid"
  | "cancelled"
  | "returned";

export type Order = {
  id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  email: string | null;
  region: string | null;
  address: string | null;
  national_address: string | null;
  items: OrderItem[];
  total: number;
  shipping_cost: number;
  discount: number;
  status: OrderStatus;
  shipping_method: string | null;
  carrier_code: string | null;
  delivery_option_id: number | null;
  tracking_number: string | null;
  tracking_url: string | null;
  payment_method: string | null;
  transfer_receipt_url: string | null;
  notes: string | null;
  created_at: string;
};

export type Settings = {
  id: number;
  site_name: string;
  store_logo: string | null;
  hero_image: string | null;
  hero_image_mobile: string | null;
  hero_title: string;
  hero_subtitle: string;
  hero_cta_text: string | null;
  hero_cta_link: string | null;
  announcement: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagram: string | null;
  tiktok: string | null;
  snapchat: string | null;
  twitter: string | null;
  payment_instructions: string;
  bank_name: string | null;
  iban: string | null;
  account_name: string | null;
  shipping_fee: number;
  free_shipping_threshold: number;
  commercial_register: string | null;
  tax_number: string | null;
  footer_text: string | null;
  font_family?: "cairo" | "system";
  base_font_size?: number;
  heading_scale?: number;
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
  card_radius?: number;
  header_footer_font_size?: number;
  currency_mark_url?: string | null;
  show_currency_mark?: boolean;
};

export type Page = {
  id: string;
  slug: string;
  title: string;
  content: string | null;
  is_active: boolean;
  created_at: string;
};

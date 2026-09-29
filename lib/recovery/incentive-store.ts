/**
 * G6-C — adapter القاعدة لبوابة قسيمة الاسترجاع.
 *
 * كل الكتابة هنا بـservice role (المسار نفسه الذي يقرأ منه الـdispatcher)،
 * وبأعمدة معلنة في `sql/migration-041-recovery-coupon.sql` فقط. الملف لا
 * يُنفّذ SQL ولا ينشئ كودًا: المنطق كله في `./incentive`.
 *
 * ملاحظات سلامة:
 *  - `markCaseDiscounted` يكتب `discount_ref` بشرط ألّا يكون موجودًا (eq
 *    is null) ⇒ سباقان لا يضاعفان عدّاد الحالة. الزيادة تُحسب في القاعدة
 *    بـSQL لا بقراءة/كتابة من التطبيق.
 *  - لا تسجيل للكود أو الجوال في السجلّات إطلاقًا.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { CouponIncentiveRow, IncentiveStore } from "./incentive";

const COUPON_COLUMNS =
  "id, code, type, value, max_discount, min_order, starts_at, ends_at, usage_limit, used_count, is_active, customer_identifier, recovery_case_id, scope, source";

type Admin = ReturnType<typeof createAdminClient>;

function toRow(value: Record<string, unknown>): CouponIncentiveRow {
  return {
    id: String(value.id),
    code: String(value.code),
    type: value.type === "fixed" ? "fixed" : "percent",
    value: Number(value.value ?? 0),
    max_discount: value.max_discount === null || value.max_discount === undefined ? null : Number(value.max_discount),
    min_order: Number(value.min_order ?? 0),
    starts_at: (value.starts_at as string | null) ?? null,
    ends_at: (value.ends_at as string | null) ?? null,
    usage_limit: Number(value.usage_limit ?? 0),
    used_count: Number(value.used_count ?? 0),
    is_active: value.is_active === true,
    customer_identifier: (value.customer_identifier as string | null) ?? null,
    recovery_case_id: (value.recovery_case_id as string | null) ?? null,
    scope: (value.scope as string | null) ?? null,
    source: (value.source as string | null) ?? null,
  };
}

export function supabaseIncentiveStore(admin: Admin = createAdminClient()): IncentiveStore {
  return {
    async findByCaseId(caseId) {
      const { data, error } = await admin
        .from("coupons")
        .select(COUPON_COLUMNS)
        .eq("recovery_case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn("[recovery] coupon read failed", { code: error.code });
        return null;
      }
      return data ? toRow(data as Record<string, unknown>) : null;
    },

    async codeExists(code) {
      const { data, error } = await admin.from("coupons").select("id").eq("code", code).maybeSingle();
      if (error) {
        console.warn("[recovery] coupon code probe failed", { code: error.code });
        return true; // لا نولّد كودًا بعد فحص فاشل: إعادة السحب أمتن
      }
      return data !== null;
    },

    async insert(row) {
      const { error } = await admin.from("coupons").insert({
        id: row.id,
        code: row.code,
        type: row.type,
        value: row.value,
        max_discount: row.max_discount,
        min_order: row.min_order,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        usage_limit: row.usage_limit,
        used_count: row.used_count,
        is_active: row.is_active,
        customer_identifier: row.customer_identifier,
        recovery_case_id: row.recovery_case_id,
        scope: row.scope,
        source: row.source,
      });
      // الخطأ يُرفع كما هو (23505 يحتاجه createIncentive لقراءة الفائزة).
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
    },

    async markCaseDiscounted(caseId, code, at) {
      const { error } = await admin
        .from("recovery_cases")
        .update({
          discount_ref: code,
          discount_count: 1,
          last_discount_at: new Date(at).toISOString(),
          updated_at: new Date(at).toISOString(),
        })
        .eq("id", caseId)
        .is("discount_ref", null);
      if (error) {
        // القسيمة نفسها أُنشئت وتبقى صالحة؛ فقط سجلّ الحالة لم يتحدّث.
        // نُسجّل بلا كود ولا PII، والدورة التالية ستقرأ القسيمة من `coupons`.
        console.warn("[recovery] case discount mark failed", { code: error.code });
      }
    },
  };
}

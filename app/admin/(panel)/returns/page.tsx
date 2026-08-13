import { createAdminClient } from "@/lib/supabase/admin";
import { updateReturnRequestAction } from "@/app/actions/customer-data";

export default async function AdminReturnsPage() {
  const { data: returns } = await createAdminClient().from("return_requests").select("*,orders(order_number,customer_name,customer_phone,total)").order("created_at", { ascending: false });
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold text-stone-900">مراجعة المرتجعات</h1><p className="mt-1 text-sm text-stone-500">مراجعة طلبات الاسترجاع واتخاذ القرار.</p></div>
      {!returns?.length ? <div className="rounded-2xl border border-amber-100 bg-white p-12 text-center text-stone-400">لا توجد طلبات استرجاع</div> : returns.map((request: any) => (
        <article key={request.id} className="rounded-2xl border border-amber-100 bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3"><div><b>طلب #{request.orders?.order_number}</b><p className="mt-1 text-sm text-stone-500">{request.orders?.customer_name} — {request.orders?.customer_phone}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold">{request.status}</span></div>
          <p className="mt-4 text-sm">السبب: {request.reason}</p>{request.details && <p className="mt-1 text-sm text-stone-500">{request.details}</p>}
          <form action={async (formData) => { await updateReturnRequestAction(formData); }} className="mt-4 flex flex-wrap gap-2"><input type="hidden" name="id" value={request.id} /><select name="status" defaultValue={request.status} className="rounded-xl border border-sand px-3 py-2 text-sm"><option value="pending">قيد المراجعة</option><option value="approved">مقبول</option><option value="rejected">مرفوض</option><option value="received">تم الاستلام</option><option value="refunded">تم رد المبلغ</option></select><input name="admin_note" placeholder="ملاحظة الإدارة" className="input-lux max-w-sm" /><button className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white">حفظ القرار</button></form>
        </article>
      ))}
    </div>
  );
}

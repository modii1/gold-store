"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Loader2, Truck, ExternalLink, DollarSign } from "lucide-react";
import { approveReturnRequestAction, updateReturnRequestAction } from "@/app/actions/customer-data";

type ReturnRequest = {
  id: string;
  order_id: string;
  customer_identifier: string;
  reason: string;
  details: string | null;
  status: string;
  admin_note: string | null;
  oto_return_order_id: string | null;
  return_tracking_number: string | null;
  return_tracking_url: string | null;
  return_delivery_company: string | null;
  return_delivery_option_name: string | null;
  return_print_awb_url: string | null;
  return_fee: number | null;
  return_status: string | null;
  return_error: string | null;
  return_shipped_at: string | null;
  created_at: string;
  orders: {
    order_number: number;
    customer_name: string;
    customer_phone: string;
    total: number;
  } | null;
};

export function ReturnCard({ request }: { request: ReturnRequest }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; returnOrderId?: string; returnFee?: number | null } | null>(null);
  const [status, setStatus] = useState(request.status);
  const [adminNote, setAdminNote] = useState(request.admin_note || "");

  const handleApprove = async () => {
    if (!confirm("هل أنت متأكد من الموافقة على هذا المرتجع؟ سيتم إنشاء شحنة مرتجع تلقائياً عبر OTO.")) return;
    setLoading(true);
    setResult(null);
    const res = await approveReturnRequestAction(request.id);
    setResult(res);
    if (res.success) setStatus("approved");
    setLoading(false);
  };

  const handleReject = async () => {
    setLoading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("id", request.id);
    fd.append("status", "rejected");
    fd.append("admin_note", adminNote);
    const res = await updateReturnRequestAction(fd);
    setResult(res);
    if (res.success) setStatus("rejected");
    setLoading(false);
  };

  const handleUpdateStatus = async (newStatus: string) => {
    setLoading(true);
    const fd = new FormData();
    fd.append("id", request.id);
    fd.append("status", newStatus);
    fd.append("admin_note", adminNote);
    const res = await updateReturnRequestAction(fd);
    if (res.success) setStatus(newStatus);
    setLoading(false);
  };

  const statusColors: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    rejected: "bg-red-50 text-red-700 border border-red-200",
    received: "bg-blue-50 text-blue-700 border border-blue-200",
    refunded: "bg-stone-100 text-stone-700 border border-stone-200",
  };

  const statusLabels: Record<string, string> = {
    pending: "قيد المراجعة",
    approved: "مقبول",
    rejected: "مرفوض",
    received: "تم الاستلام",
    refunded: "تم رد المبلغ",
  };

  return (
    <article className="rounded-2xl border border-amber-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <b>طلب #{request.orders?.order_number}</b>
          <p className="mt-1 text-sm text-stone-500">
            {request.orders?.customer_name} — {request.orders?.customer_phone}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusColors[status] || statusColors.pending}`}>
          {statusLabels[status] || status}
        </span>
      </div>

      <p className="mt-4 text-sm">السبب: {request.reason}</p>
      {request.details && <p className="mt-1 text-sm text-stone-500">{request.details}</p>}

      {/* Return shipment info */}
      {(request.oto_return_order_id || request.return_fee || request.return_error) && (
        <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-2">
          <h4 className="text-xs font-bold text-stone-700 mb-2">معلومات شحنة المرتجع</h4>
          {request.oto_return_order_id && (
            <div className="flex items-center gap-2 text-sm">
              <Truck className="w-4 h-4 text-gold" />
              <span>رقم شحنة المرتجع: <b className="text-stone-900">{request.oto_return_order_id}</b></span>
            </div>
          )}
          {request.return_delivery_company && (
            <div className="text-sm text-stone-600">شركة الشحن: {request.return_delivery_company}</div>
          )}
          {request.return_delivery_option_name && (
            <div className="text-sm text-stone-600">خدمة الشحن: {request.return_delivery_option_name}</div>
          )}
          {request.return_fee != null && request.return_fee > 0 && (
            <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
              <DollarSign className="w-4 h-4" />
              <span>تكلفة الإرجاع: {request.return_fee} ر.س</span>
            </div>
          )}
          {request.return_tracking_url && (
            <a href={request.return_tracking_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-gold hover:underline">
              تتبع شحنة المرتجع <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {request.return_error && (
            <p className="text-sm text-red-600">خطأ: {request.return_error}</p>
          )}
        </div>
      )}

      {result?.error && <p className="mt-3 text-sm text-red-600">{result.error}</p>}
      {result?.success && result.returnOrderId && (
        <p className="mt-3 text-sm text-emerald-600 font-bold">
          تم إنشاء شحنة المرتجع — رقم الإرجاع: {result.returnOrderId}
        </p>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex flex-col gap-3">
        {status === "pending" && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleApprove}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              موافقة وإنشاء شحنة مرتجع
            </button>
            <button
              onClick={handleReject}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              رفض
            </button>
          </div>
        )}

        {status === "approved" && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleUpdateStatus("received")}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              تم الاستلام
            </button>
            <button
              onClick={() => handleUpdateStatus("refunded")}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-stone-600 px-4 py-2 text-sm font-bold text-white hover:bg-stone-700 transition disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              تم رد المبلغ
            </button>
          </div>
        )}

        {status === "received" && (
          <button
            onClick={() => handleUpdateStatus("refunded")}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-stone-600 px-4 py-2 text-sm font-bold text-white hover:bg-stone-700 transition disabled:opacity-50 w-fit"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            تم رد المبلغ
          </button>
        )}

        {status === "pending" && (
          <input
            type="text"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="ملاحظة الإدارة (اختياري)"
            className="input-lux w-full sm:max-w-sm"
          />
        )}
      </div>
    </article>
  );
}

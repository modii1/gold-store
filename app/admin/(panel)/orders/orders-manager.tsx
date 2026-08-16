"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw, Download, Printer, Loader2, X, Truck, Trash2 } from "lucide-react";
import type { Carrier, Order, OrderDetails, OrderSortKey, OrdersQueryParams, OrderStats, Settings } from "@/types";
import {
  updateOrderStatusAction, deleteOrderAction, createShipmentAction, approveTransferAction,
  rejectTransferAction, bulkUpdateOrdersAction, getOrderDetailsAction, exportOrdersCsvAction,
} from "@/app/actions/orders-admin";
import { buildOrdersQueryString } from "@/lib/orders/query";
import { formatDateOnly, pluralizeArabic } from "@/lib/format";
import { OrdersStats } from "./orders-stats";
import { OrderFilters } from "./order-filters";
import { OrdersTable } from "./orders-table";
import { OrderDrawer } from "./order-drawer";
import { Modal } from "./order-modal";
import { ToastViewport, type Toast } from "./order-toasts";
import { InvoicePreview } from "./order-invoice";

type Props = {
  orders: Order[];
  total: number;
  pages: number;
  page: number;
  limit: number;
  stats: OrderStats;
  params: OrdersQueryParams;
  carriers: Carrier[];
  settings: Settings;
};

const BULK_STATUS_OPTIONS = [
  { value: "pending", label: "قيد المراجعة" },
  { value: "confirmed", label: "مؤكد" },
  { value: "processing", label: "قيد التجهيز" },
  { value: "shipped", label: "تم الشحن" },
  { value: "delivered", label: "تم التسليم" },
  { value: "paid", label: "مدفوع" },
  { value: "cancelled", label: "ملغي" },
];

function ordersToCsvClient(rows: Order[]): string {
  const headers = ["رقم الطلب", "العميل", "الهاتف", "المدينة", "حالة الطلب", "الإجمالي", "طريقة الدفع", "شركة الشحن", "رقم التتبع", "التاريخ"];
  const escape = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((o) =>
    [o.order_number, o.customer_name, o.customer_phone, o.customer_city, o.status, o.total, o.payment_method, o.shipping_method, o.tracking_number, formatDateOnly(o.created_at)]
      .map(escape)
      .join(",")
  );
  return [headers.map(escape).join(","), ...lines].join("\n");
}

export function OrdersManager({ orders, total, pages, page, limit, stats, params, carriers, settings }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [selected, setSelected] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const toastSeq = useRef(1);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerData, setDrawerData] = useState<OrderDetails | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerTick, setDrawerTick] = useState(0);

  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Order | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkStatusSel, setBulkStatusSel] = useState("processing");
  const [bulkShip, setBulkShip] = useState(false);
  const [invoiceOrders, setInvoiceOrders] = useState<Order[] | null>(null);

  const selectedOrders = orders.filter((o) => selected.includes(o.id));

  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastSeq.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  /** Apply a patch to URL query params — triggers server re-render without full reload. */
  const apply = useCallback(
    (patch: Partial<OrdersQueryParams>, resetPage = true) => {
      const next = { ...params, ...patch };
      if (resetPage) next.page = 1;
      router.replace(pathname + buildOrdersQueryString(next), { scroll: false });
    },
    [params, pathname, router]
  );

  const refreshQuiet = useCallback(() => {
    router.refresh();
    setDrawerTick((t) => t + 1);
  }, [router]);

  // ======================= Single-order actions =======================

  const runStatus = useCallback(
    async (o: Order, target: string, label: string) => {
      setBusyId(o.id);
      const fd = new FormData();
      fd.set("id", o.id);
      fd.set("status", target);
      const res = await updateOrderStatusAction(fd);
      setBusyId(null);
      if (res.error) pushToast("error", res.error);
      else {
        pushToast("success", `${label} — طلب #${o.order_number}`);
        refreshQuiet();
      }
    },
    [pushToast, refreshQuiet]
  );

  const ship = useCallback(
    async (o: Order) => {
      setBusyId(o.id);
      const fd = new FormData();
      fd.set("id", o.id);
      const res = await createShipmentAction(fd);
      setBusyId(null);
      if (res.error) pushToast("error", res.error);
      else {
        pushToast("success", (res as { message?: string }).message || `تم إنشاء الشحنة — طلب #${o.order_number}`);
        refreshQuiet();
      }
    },
    [pushToast, refreshQuiet]
  );

  const approveTransfer = useCallback(
    async (o: Order) => {
      setBusyId(o.id);
      const fd = new FormData();
      fd.set("id", o.id);
      const res = await approveTransferAction(fd);
      setBusyId(null);
      if (res.error) pushToast("error", res.error);
      else {
        pushToast("success", `تم اعتماد التحويل — طلب #${o.order_number}`);
        refreshQuiet();
      }
    },
    [pushToast, refreshQuiet]
  );

  const confirmRejectTransfer = async () => {
    if (!rejectTarget) return;
    const target = rejectTarget;
    setBusyId(target.id);
    const fd = new FormData();
    fd.set("id", target.id);
    fd.set("note", rejectNote.trim() || "تم رفض إثبات التحويل");
    const res = await rejectTransferAction(fd);
    setBusyId(null);
    setRejectTarget(null);
    setRejectNote("");
    if (res.error) pushToast("error", res.error);
    else {
      pushToast("success", `تم رفض التحويل — طلب #${target.order_number}`);
      refreshQuiet();
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    const fd = new FormData();
    fd.set("id", target.id);
    const res = await deleteOrderAction(fd);
    setBusyId(null);
    setDeleteTarget(null);
    if (res.error) pushToast("error", res.error);
    else {
      pushToast("success", `تم حذف الطلب #${target.order_number}`);
      refreshQuiet();
    }
  };

  const copyOrder = useCallback(
    async (o: Order) => {
      try {
        await navigator.clipboard.writeText(`#${o.order_number}`);
        pushToast("success", "تم نسخ رقم الطلب");
      } catch {
        pushToast("error", "تعذر النسخ");
      }
    },
    [pushToast]
  );

  // ======================= Bulk actions =======================

  const confirmBulkStatus = async () => {
    if (!bulkStatus || !selected.length) return;
    setBusyKey("bulk");
    const res = await bulkUpdateOrdersAction(selected, bulkStatus);
    setBusyKey(null);
    setBulkStatus(null);
    setSelected([]);
    if (res.error) return pushToast("error", res.error);
    if (res.updated) pushToast("success", `تم تحديث ${res.updated} ${pluralizeArabic(res.updated, "طلب", "طلبين", "طلبات")}${res.failed ? `، وفشل ${res.failed}` : ""}`);
    if (res.failed && !res.updated) pushToast("error", `فشل تحديث ${res.failed} طلبات`);
    refreshQuiet();
  };

  const confirmBulkShip = async () => {
    const targets = selectedOrders.filter((o) => o.status === "processing");
    if (!targets.length) {
      setBulkShip(false);
      return;
    }
    setBusyKey("bulk");
    let ok = 0;
    const failed: number[] = [];
    for (const o of targets) {
      const fd = new FormData();
      fd.set("id", o.id);
      const res = await createShipmentAction(fd);
      if (res.error) failed.push(o.order_number);
      else ok++;
    }
    setBusyKey(null);
    setBulkShip(false);
    setSelected([]);
    if (ok) pushToast("success", `تم إنشاء ${ok} ${pluralizeArabic(ok, "شحنة", "شحنتين", "شحنات")}${failed.length ? `، وفشل ${failed.length}` : ""}`);
    if (failed.length) pushToast("error", `فشلت الشحنات: #${failed.join(", #")}`);
    refreshQuiet();
  };

  // ======================= Export =======================

  const downloadCsv = (csv: string, suffix = "all") => {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = async () => {
    setBusyKey("csv");
    const res = await exportOrdersCsvAction(params);
    setBusyKey(null);
    if (res.error) return pushToast("error", res.error);
    if (!res.csv) return pushToast("error", "لا توجد بيانات للتصدير");
    downloadCsv(res.csv);
    pushToast("success", "تم تصدير الطلبات");
  };

  const exportSelected = () => {
    if (!selectedOrders.length) return;
    downloadCsv(ordersToCsvClient(selectedOrders), "selected");
    pushToast("success", `تم تصدير ${selectedOrders.length} طلب`);
  };

  // ======================= Drawer =======================

  useEffect(() => {
    if (!drawerId) {
      setDrawerData(null);
      setDrawerLoading(false);
      setDrawerError(null);
      return;
    }
    let active = true;
    setDrawerLoading(true);
    setDrawerError(null);
    setDrawerData(null);
    void getOrderDetailsAction(drawerId).then((res) => {
      if (!active) return;
      setDrawerLoading(false);
      if (res.error) setDrawerError(res.error);
      else setDrawerData(res as OrderDetails);
    });
    return () => {
      active = false;
    };
  }, [drawerId, drawerTick]);

  // Global Escape closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerId(null);
      setDeleteTarget(null);
      setRejectTarget(null);
      setBulkStatus(null);
      setBulkShip(false);
      setInvoiceOrders(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onSort = useCallback(
    (key: OrderSortKey) => {
      const dir = params.sort === key && params.dir === "asc" ? "desc" : "asc";
      apply({ sort: key, dir }, false);
    },
    [params, apply]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">الطلبات</h1>
          <p className="mt-1 text-sm text-stone-500">إدارة ومتابعة جميع طلبات المتجر والشحن والدفع من مكان واحد</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              pushToast("info", "جاري تحديث البيانات...");
              router.refresh();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تحديث
          </button>
          <button
            onClick={() => void exportAll()}
            disabled={busyKey === "csv"}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
          >
            {busyKey === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            تصدير CSV
          </button>
          {selected.length > 0 && (
            <button
              onClick={() => setInvoiceOrders(selectedOrders)}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-2 text-xs font-bold text-white hover:bg-gold-dark"
            >
              <Printer className="h-3.5 w-3.5" /> طباعة المحدد
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <OrdersStats stats={stats} onApply={(p) => apply(p as Partial<OrdersQueryParams>)} />

      {/* Filters */}
      <OrderFilters
        params={params}
        carriers={carriers}
        onChange={(p) => apply(p)}
        onClear={() => apply({ q: undefined, status: "all", payment: "all", payment_method: "all", carrier: "all", from: undefined, to: undefined })}
      />

      {/* Bulk bar */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold/30 bg-amber-50 px-4 py-3">
          <p className="text-sm font-extrabold text-stone-800">تم تحديد {selected.length} طلب</p>
          <select
            value={bulkStatusSel}
            onChange={(e) => setBulkStatusSel(e.target.value)}
            aria-label="حالة جماعية"
            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs focus:border-gold focus:outline-none"
          >
            {BULK_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={() => setBulkStatus(bulkStatusSel)}
            disabled={busyKey === "bulk"}
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-ivory hover:bg-gold disabled:opacity-50"
          >
            تغيير الحالة
          </button>
          <button
            onClick={() => {
              if (selectedOrders.some((o) => o.status === "processing")) setBulkShip(true);
              else pushToast("info", "لا توجد طلبات قابلة للشحن بين المحدد");
            }}
            disabled={busyKey === "bulk"}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Truck className="h-3.5 w-3.5" /> شحن المحدد
          </button>
          <button onClick={exportSelected} className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-stone-600 hover:bg-stone-100">
            <Download className="h-3.5 w-3.5" /> تصدير المحدد
          </button>
          <button
            onClick={() => setInvoiceOrders(selectedOrders)}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-stone-600 hover:bg-stone-100"
          >
            <Printer className="h-3.5 w-3.5" /> طباعة
          </button>
          <button
            onClick={() => setSelected([])}
            className="mr-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-400 hover:text-stone-600"
          >
            <X className="h-3.5 w-3.5" /> إلغاء التحديد
          </button>
        </div>
      )}

      {/* Table / cards + pagination */}
      <OrdersTable
        orders={orders}
        total={total}
        pages={pages}
        page={page}
        limit={limit}
        params={params}
        selected={selected}
        busyId={busyId}
        onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
        onToggleAll={() =>
          setSelected((s) => {
            const pageIds = orders.map((o) => o.id);
            const allPicked = pageIds.length > 0 && pageIds.every((id) => s.includes(id));
            if (allPicked) return s.filter((id) => !pageIds.includes(id));
            return [...new Set([...s, ...pageIds])];
          })
        }
        onSort={onSort}
        onPage={(n) => apply({ page: n }, false)}
        onLimit={(l) => apply({ limit: l })}
        onOpen={(o) => setDrawerId(o.id)}
        onStatus={runStatus}
        onShip={ship}
        onApproveTransfer={approveTransfer}
        onRejectTransfer={(o) => setRejectTarget(o)}
        onDelete={(o) => setDeleteTarget(o)}
        onPrint={(o) => setInvoiceOrders([o])}
        onCopy={copyOrder}
      />

      {/* Drawer */}
      <OrderDrawer
        drawer={{ open: !!drawerId, orderId: drawerId, data: drawerData, loading: drawerLoading, error: drawerError }}
        busyId={busyId}
        onClose={() => setDrawerId(null)}
        onStatus={runStatus}
        onShip={ship}
        onApproveTransfer={approveTransfer}
        onRejectTransfer={(o) => setRejectTarget(o)}
        onPrint={(o) => setInvoiceOrders([o])}
        onCopy={copyOrder}
      />

      {/* Delete modal */}
      <Modal
        open={!!deleteTarget}
        title="حذف الطلب"
        danger
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50">إلغاء</button>
            <button
              onClick={() => void confirmDelete()}
              disabled={busyId === deleteTarget?.id}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busyId === deleteTarget?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              حذف نهائي
            </button>
          </>
        }
      >
        <p className="text-sm text-stone-600">هل أنت متأكد من حذف الطلب <b>#{deleteTarget?.order_number}</b>؟</p>
        <p className="mt-2 text-xs font-bold text-rose-500">هذا الإجراء لا يمكن التراجع عنه.</p>
      </Modal>

      {/* Reject transfer modal */}
      <Modal
        open={!!rejectTarget}
        title="رفض التحويل البنكي"
        danger
        onClose={() => {
          setRejectTarget(null);
          setRejectNote("");
        }}
        footer={
          <>
            <button
              onClick={() => {
                setRejectTarget(null);
                setRejectNote("");
              }}
              className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50"
            >
              إلغاء
            </button>
            <button
              onClick={() => void confirmRejectTransfer()}
              disabled={busyId === rejectTarget?.id}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busyId === rejectTarget?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "تأكيد الرفض"}
            </button>
          </>
        }
      >
        <p className="text-sm text-stone-600">رفض إثبات التحويل للطلب <b>#{rejectTarget?.order_number}</b>؟</p>
        <textarea
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="سبب الرفض (يُسجل كملاحظة)"
          rows={3}
          className="mt-3 w-full rounded-lg border border-stone-200 p-3 text-sm focus:border-gold focus:outline-none"
        />
      </Modal>

      {/* Bulk status modal */}
      <Modal
        open={!!bulkStatus}
        title="تغيير الحالة جماعياً"
        onClose={() => setBulkStatus(null)}
        footer={
          <>
            <button onClick={() => setBulkStatus(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50">إلغاء</button>
            <button
              onClick={() => void confirmBulkStatus()}
              disabled={busyKey === "bulk"}
              className="rounded-lg bg-gold px-4 py-2 text-xs font-bold text-white hover:bg-gold-dark disabled:opacity-50"
            >
              {busyKey === "bulk" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "تأكيد"}
            </button>
          </>
        }
      >
        <p className="text-sm text-stone-600">
          هل أنت متأكد من تنفيذ تغيير الحالة إلى <b>"{BULK_STATUS_OPTIONS.find((s) => s.value === bulkStatus)?.label}"</b> على{" "}
          <b>{selected.length}</b> {pluralizeArabic(selected.length, "طلب", "طلبين", "طلبات")}؟
        </p>
      </Modal>

      {/* Bulk ship modal */}
      <Modal
        open={bulkShip}
        title="إنشاء شحنات جماعية"
        onClose={() => setBulkShip(false)}
        footer={
          <>
            <button onClick={() => setBulkShip(false)} className="rounded-lg border border-stone-200 px-4 py-2 text-xs font-bold text-stone-600 hover:bg-stone-50">إلغاء</button>
            <button
              onClick={() => void confirmBulkShip()}
              disabled={busyKey === "bulk"}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyKey === "bulk" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
              إنشاء الشحنات
            </button>
          </>
        }
      >
        <p className="text-sm text-stone-600">
          إنشاء شحنة لـ <b>{selectedOrders.filter((o) => o.status === "processing").length}</b> طلب من المحدد عبر شركة الشحن المسجلة للطلب؟
        </p>
      </Modal>

      {/* Invoice */}
      {invoiceOrders && <InvoicePreview orders={invoiceOrders} settings={settings} onClose={() => setInvoiceOrders(null)} />}

      {/* Toasts */}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

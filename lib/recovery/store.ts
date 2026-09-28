import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryCase, RecoveryCaseEvent, RecoveryCaseEventType } from "./types";
import { RECOVERY_CASE_EVENT_TYPES } from "./types";
import type { RecoveryIntervention } from "./metrics";

/** جدول سجل التدخلات الدائم (migration-036). */
const ATTEMPTS_TABLE = "recovery_contact_attempts";
/** جدول سجل أحداث الحالة (migration-037). append-only. */
const EVENTS_TABLE = "recovery_case_events";

/**
 * المخزن — فصل كامل عن منطق القرار. المرحلة الأولى (بلا migration) تعمل فقط
 * عبر InMemoryStore (للاختبارات) ومخزن Supabase محروس لا يكتب حتى يُنشأ الجدول.
 */
export interface RecoveryCaseStore {
  readonly ready: boolean;
  create(c: RecoveryCase): Promise<void>;
  update(id: string, patch: Partial<RecoveryCase>): Promise<void>;
  findActiveByVisitor(visitorId: string): Promise<RecoveryCase | null>;
  findLatestByVisitor(visitorId: string): Promise<RecoveryCase | null>;
  findActiveByCustomer(phone: string): Promise<RecoveryCase[]>;
  listActive(): Promise<RecoveryCase[]>;
  listAll(limit?: number): Promise<RecoveryCase[]>;
  /** جلب حالات محدّدة بالمعرّفات — للتسوية خارج نطاق الحالات النشطة. */
  findByIds(ids: string[]): Promise<Map<string, RecoveryCase>>;
  /** سجل التدخلات الدائم — مصدر الحقيقة الوحيد لإثبات الاستعادة. */
  listInterventions(caseIds?: string[]): Promise<Map<string, RecoveryIntervention[]>>;
  /**
   * سجل التدخلات الدائم — مصدر الحقيقة الوحيد لإثبات الاستعادة.
   *
   * `id` اختياري لكنه حاسم: إن مُرِّر كـ UUID حتمي، فيصبح الـINSERT نفسه حارس
   * التكرار على مستوى قاعدة البيانات (23505 عند التكرار) بدل مقارنة
   * القراءة-قبل-الكتابة التي تتسابق بين عمليتي cron.
   */
  recordIntervention(a: { id?: string; caseId: string; channel: string; sentAt?: number; couponRef?: string | null }): Promise<boolean>;
  /**
   * سجل أحداث الحالة (recovery_case_events) — أساس «سجل الحالة التفصيلي».
   *
   * قاعدة الاستدعاء: بعد وقوع الفعل لا قبله. القرار (decision) لا يُسجَّل
   * كحدث منفَّذ، ولا تُسجَّل رسالة قبل تأكيد التسليم.
   * ولا تُسجَّل رسالة قبل تأكيد التسليم.
   * لا يرمي أبدًا: تعذّر الكتابة = false (fail-closed) حتى لا ينكسر مسار
   * الإرسال القائم بسبب سجل عرض.
   */
  appendCaseEvent(e: {
    caseId: string;
    eventType: RecoveryCaseEventType;
    stageKey?: string | null;
    templateId?: number | null;
    summaryAr?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<boolean>;
  /** أحداث الحالات (أو كل الأحداث إن تُركت فارغة)، مرتّبة زمنيًا تصاعديًا. */
  listCaseEvents(caseIds?: string[]): Promise<Map<string, RecoveryCaseEvent[]>>;
}


export function newCaseId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

const ACTIVE_FILTER = "status.in.(OPEN,ELIGIBLE,SCHEDULED,CONTACTED)";

/**
 * F3: التحقق من صلاحية UUID قبل كتابته في purchase_ref.
 * purchase_ref نوعه uuid؛ وقيمته تأتي من notification_events.order_id
 * (نوعه text) فلا نضمن شكله. أي قيمة غير صالحة تُرفَض بدل كسر الـupdate.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** سبب رفض قيمة order_id قبل ربطها بـ purchase_ref. */
export type OrderRefProblem = "missing" | "empty" | "whitespace" | "not_uuid";

/**
 * تصنيف قيمة order_id (من notification_events.order_id وهو text) قبل ربطها
 * بـ purchase_ref (نوعه uuid).
 *
 * القواعد:
 *  - missing: الحقل غائب/غير نصي (undefined | null | أي نوع غير string).
 *  - empty / whitespace: نص فارغ أو مسافات فقط.
 *  - not_uuid: نص موجود لكنه ليس UUID صالحًا.
 *  - "valid": يُرجع القيم المُطبَّعة (مقصوصّة المسافات) صالحة للكتابة.
 *  - أي حالة غير صالحة تُرجع purchaseRef=null — لا قيمة تُكتب في purchase_ref.
 */
export type OrderRefResolution =
  | { ok: true; normalized: string; problem: null }
  | { ok: false; normalized: null; problem: OrderRefProblem };

export function resolveOrderRef(value: unknown): OrderRefResolution {
  if (typeof value !== "string") return { ok: false, normalized: null, problem: "missing" };
  if (value === "") return { ok: false, normalized: null, problem: "empty" };
  if (!value.trim()) return { ok: false, normalized: null, problem: "whitespace" };
  if (!UUID_RE.test(value.trim())) return { ok: false, normalized: null, problem: "not_uuid" };
  return { ok: true, normalized: value.trim(), problem: null };
}

/**
 * إخفاء الجوال جزئيًا (***1234) — للعرض في اللوحات والسجلات فقط.
 * لا يُستخدم في التخزين: قيمة قاعدة البيانات تبقى كما هي.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export class InMemoryRecoveryStore implements RecoveryCaseStore {
  readonly ready = true;
  private rows = new Map<string, RecoveryCase>();
  private attempts = new Map<string, RecoveryIntervention[]>();
  private attemptIds = new Set<string>();
  private events = new Map<string, RecoveryCaseEvent[]>();
  private eventSeq = 0;

  async create(c: RecoveryCase): Promise<void> {
    this.rows.set(c.id, c);
  }

  async appendCaseEvent(e: {
    caseId: string;
    eventType: RecoveryCaseEventType;
    stageKey?: string | null;
    templateId?: number | null;
    summaryAr?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<boolean> {
    this.eventSeq += 1;
    const list = this.events.get(e.caseId) ?? [];
    list.push({
      id: `evt-${this.eventSeq}`,
      caseId: e.caseId,
      eventType: e.eventType,
      stageKey: e.stageKey ?? null,
      templateId: e.templateId ?? null,
      summaryAr: e.summaryAr ?? "",
      payload: e.payload ?? {},
      createdAt: Date.now(),
    });
    this.events.set(e.caseId, list);
    return true;
  }

  async listCaseEvents(caseIds?: string[]): Promise<Map<string, RecoveryCaseEvent[]>> {
    const out = new Map<string, RecoveryCaseEvent[]>();
    for (const [caseId, list] of this.events) {
      if (caseIds && caseIds.length && !caseIds.includes(caseId)) continue;
      out.set(caseId, [...list].sort((a, b) => a.createdAt - b.createdAt));
    }
    return out;
  }

  async findByIds(ids: string[]): Promise<Map<string, RecoveryCase>> {
    const out = new Map<string, RecoveryCase>();
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) out.set(id, row);
    }
    return out;
  }

  async listInterventions(caseIds?: string[]): Promise<Map<string, RecoveryIntervention[]>> {
    const out = new Map<string, RecoveryIntervention[]>();
    for (const [caseId, list] of this.attempts) {
      if (caseIds && caseIds.length && !caseIds.includes(caseId)) continue;
      out.set(caseId, [...list].sort((a, b) => a.sentAt - b.sentAt));
    }
    return out;
  }

  async recordIntervention(a: { id?: string; caseId: string; channel: string; sentAt?: number; couponRef?: string | null }): Promise<boolean> {
    // حارس التكرار: نفس المعرّف = تدخّل واحد فقط، مهما تكرّرت الدورة.
    if (a.id) {
      if (this.attemptIds.has(a.id)) return false;
      this.attemptIds.add(a.id);
    }
    const list = this.attempts.get(a.caseId) ?? [];
    list.push({
      caseId: a.caseId,
      channel: a.channel,
      sentAt: a.sentAt ?? Date.now(),
      couponRef: a.couponRef ?? null,
    });
    this.attempts.set(a.caseId, list);
    return true;
  }

  async update(id: string, patch: Partial<RecoveryCase>): Promise<void> {
    const cur = this.rows.get(id);
    if (cur) this.rows.set(id, { ...cur, ...patch, updatedAt: patch.updatedAt ?? Date.now() });
  }

  async findActiveByVisitor(visitorId: string): Promise<RecoveryCase | null> {
    for (const c of this.rows.values()) {
      if (c.visitorId === visitorId && !["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"].includes(c.status)) return c;
    }
    return null;
  }

  async findLatestByVisitor(visitorId: string): Promise<RecoveryCase | null> {
    let latest: RecoveryCase | null = null;
    for (const c of this.rows.values()) {
      if (c.visitorId === visitorId && (!latest || c.lastActivityAt > latest.lastActivityAt)) latest = c;
    }
    return latest;
  }

  async findActiveByCustomer(phone: string): Promise<RecoveryCase[]> {
    return [...this.rows.values()].filter(
      (c) => c.customerPhone === phone && !["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"].includes(c.status)
    );
  }

  async listActive(): Promise<RecoveryCase[]> {
    return [...this.rows.values()].filter((c) => !["PURCHASED", "EXPIRED", "CANCELLED", "SUPPRESSED"].includes(c.status));
  }

  async listAll(limit = 200): Promise<RecoveryCase[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, limit);
  }

  /** وصول مباشر للاختبارات فقط. */
  all(): RecoveryCase[] {
    return [...this.rows.values()];
  }
}

/**
 * مخزن Supabase مقترن بجدول recovery_cases.
 * حتى يُنشأ الجدول (بعد موافقتك على migration-034) يبقى ready=false
 * وكل الأساليب لا تفعل شيئًا — بلا أي كتابة إنتاج.
 */
export type RecoveryStoreError = { op: "create" | "update"; code?: string; message: string };

export type SupabaseRecoveryStoreOptions = {
  /** للاختبارات: عميل وهمي. الافتراضي عميل service_role الحقيقي. */
  createClient?: () => SupabaseClient;
  /** للاختبارات: التقاط الأخطاء بدل console. لا يجب أن يرمي. */
  onError?: (e: RecoveryStoreError) => void;
};

/**
 * مسجّل الأخطاء الافتراضي: console.warn فقط.
 * لا نطبع أي صف/مفتاح/بيانات عميل — فقط رمز ورسالة PostgREST (مقطوعة للطول).
 */
function defaultOnError(e: RecoveryStoreError): void {
  console.warn(`[recovery] ${e.op} failed: ${e.code ?? "no-code"} ${e.message}`.slice(0, 300));
}

/** رسالة خطأ آمنة: بلا أسرار، بلاحمولة بيانات. */
function safeErrorMessage(error: unknown): { code?: string; message: string } {
  const anyErr = error as { code?: unknown; message?: unknown } | null;
  return {
    code: typeof anyErr?.code === "string" ? anyErr.code : undefined,
    message: typeof anyErr?.message === "string" ? anyErr.message : "unknown error",
  };
}

export class SupabaseRecoveryStore implements RecoveryCaseStore {
  private _ready = false;
  private checked = false;
  private lastError: string | null = null;
  private readonly table = "recovery_cases";
  private readonly createClient: () => SupabaseClient;
  private readonly onError: (e: RecoveryStoreError) => void;

  constructor(options: SupabaseRecoveryStoreOptions = {}) {
    this.createClient = options.createClient ?? createAdminClient;
    this.onError = options.onError ?? defaultOnError;
  }

  /**
   * فحص الجاهزية عبر استعلام فعلي على الجدول نفسه.
   * ملاحظة: `information_schema` غير معرّضة عبر PostgREST، ولا يرمي
   * supabase-js استثناءً عند فشل الاستعلام (يُعيد { error }). لذلك نقرأ
   * `error` صراحةً — وإلا لبقي readiness=false إلى الأبد بعد الـmigration.
   */
  async ensureReady(): Promise<boolean> {
    if (this.checked) return this._ready;
    try {
      const supabase = this.createClient();
      const { error } = await supabase.from(this.table).select("id", { count: "exact", head: true }).limit(1);
      this._ready = !error;
      this.lastError = error ? `${error.code ?? ""} ${error.message}`.trim() : null;
    } catch (e) {
      this._ready = false;
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    this.checked = true;
    return this._ready;
  }

  get ready(): boolean {
    return this._ready;
  }

  /** سبب عدم الجاهزية (لعرضه في لوحة الإدارة) — لا يحتوي أي بيانات. */
  get error(): string | null {
    return this.lastError;
  }

  private guard(): boolean {
    if (this._ready) return true;
    // الجدول غير موجود بعد — منع أي كتابة إنتاج.
    return false;
  }

  /**
   * F2: insert مع فحص صريح لـ error. supabase-js لا يرمي عند فشل الاستعلام،
   * فالفحص الصريح هو ما يمنع الابتلاع الصامت. لا نرمي أبدًا حتى لا نكسر
   * مسار Analytics، لكن الخطأ يُسجَّل صراحةً عبر onError.
   */
  async create(c: RecoveryCase): Promise<void> {
    if (!this.guard()) return;
    try {
      const supabase = this.createClient();
      const { error } = await supabase.from(this.table).insert(caseToRow(c));
      if (error) this.onError({ op: "create", ...safeErrorMessage(error) });
    } catch (e) {
      this.onError({ op: "create", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * F1 + F2: update برسم partial patch حقيقي + فحص صريح لـ error.
   *
   * كان قبل الإصلاح: caseToRow({ ...emptyRow(), ...patch, id }) — أي patch جزئي
   * كان يمسح كل الحقول غير المذكورة (visitor_id='' و score=0 و timestamps=1970).
   * الآن: casePatchToRow(patch) يرسل الحقول الموجودة فقط.
   */
  async update(id: string, patch: Partial<RecoveryCase>): Promise<void> {
    if (!this.guard()) return;
    const row = casePatchToRow(patch);
    if (Object.keys(row).length === 0) return; // لا شيء لتحديثه — بلا استعلام فارغ
    try {
      const supabase = this.createClient();
      const { error } = await supabase.from(this.table).update(row).eq("id", id);
      if (error) this.onError({ op: "update", ...safeErrorMessage(error) });
    } catch (e) {
      this.onError({ op: "update", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async findActiveByVisitor(visitorId: string): Promise<RecoveryCase | null> {
    if (!this.guard()) return null;
    const supabase = this.createClient();
    const { data } = await supabase
      .from(this.table)
      .select("*")
      .eq("visitor_id", visitorId)
      .or(ACTIVE_FILTER)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? rowToCase(data) : null;
  }

  async findLatestByVisitor(visitorId: string): Promise<RecoveryCase | null> {
    if (!this.guard()) return null;
    const supabase = this.createClient();
    const { data } = await supabase
      .from(this.table)
      .select("*")
      .eq("visitor_id", visitorId)
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? rowToCase(data) : null;
  }

  async findActiveByCustomer(phone: string): Promise<RecoveryCase[]> {
    if (!this.guard()) return [];
    const supabase = this.createClient();
    const { data } = await supabase
      .from(this.table)
      .select("*")
      .eq("customer_phone", phone)
      .or(ACTIVE_FILTER);
    return ((data as Record<string, unknown>[]) || []).map(rowToCase);
  }

  async listActive(): Promise<RecoveryCase[]> {
    if (!this.guard()) return [];
    const supabase = this.createClient();
    const { data } = await supabase
      .from(this.table)
      .select("*")
      .or(ACTIVE_FILTER)
      .order("last_activity_at", { ascending: false })
      .limit(500);
    return ((data as Record<string, unknown>[]) || []).map(rowToCase);
  }

  async listAll(limit = 200): Promise<RecoveryCase[]> {
    if (!this.guard()) return [];
    const supabase = this.createClient();
    const { data } = await supabase
      .from(this.table)
      .select("*")
      .order("last_activity_at", { ascending: false })
      .limit(limit);
    return ((data as Record<string, unknown>[]) || []).map(rowToCase);
  }

  /**
   * جلب الحالات بالمعرّفات مباشرة.
   * التسوية تحتاج هذا لا listActive: رسالة قد تُؤكَّد بعد أن أُغلقت الحالة
   * بالشراء، فيبقى التدخل واجب التسجيل رغم أن الحالة لم تعد نشطة.
   */
  async findByIds(ids: string[]): Promise<Map<string, RecoveryCase>> {
    const out = new Map<string, RecoveryCase>();
    if (!ids.length || !this.guard()) return out;
    const supabase = this.createClient();
    const { data } = await supabase
      .from(this.table)
      .select("*")
      .in("id", ids);
    for (const row of (data as Record<string, unknown>[]) || []) {
      const c = rowToCase(row);
      out.set(c.id, c);
    }
    return out;
  }

  // ------------------------------------------------------------
  // سجل التدخلات الدائم — recovery_contact_attempts (append-only)
  //
  // هذا هو مصدر الحقيقة الوحيد لـ "تم استرجاعها". لا يُشتق من
  // decision / recommendedDiscount / wouldSend / nextActionAt.
  // صفٌّ هنا يجب أن يُنشأ بعد نجاح إرسال فعلي فقط.
  // ------------------------------------------------------------

  /**
   * كل التدخلات الموثّقة لحالات معيّنة (أو لكل الحالات إن تُركت فارغة).
   * تُرجع خريطة caseId -> التدخلات مرتّبة زمنيًا تصاعديًا.
   * الجدول غير موجود بعد (migration-036 غير مطبّقة) ⇒ خريطة فارغة،
   * وهو fail-closed: recovered = 0 لا انهيار.
   */
  async listInterventions(caseIds?: string[]): Promise<Map<string, RecoveryIntervention[]>> {
    const out = new Map<string, RecoveryIntervention[]>();
    if (!this.guard()) return out;
    try {
      let query = this.createClient()
        .from(ATTEMPTS_TABLE)
        .select("case_id, channel, sent_at, coupon_ref")
        .order("sent_at", { ascending: true });
      if (caseIds && caseIds.length) query = query.in("case_id", caseIds);
      const { data } = await query;
      for (const row of (data as Record<string, unknown>[]) || []) {
        const caseId = String(row.case_id ?? "");
        if (!caseId) continue;
        const sentAt = epoch(row.sent_at);
        if (sentAt === null) continue; // بلا وقت إرسال = لا يثبت تدخلًا
        const list = out.get(caseId) ?? [];
        list.push({
          caseId,
          channel: String(row.channel ?? "unknown"),
          sentAt,
          couponRef: row.coupon_ref ? String(row.coupon_ref) : null,
        });
        out.set(caseId, list);
      }
    } catch (e) {
      this.onError({ op: "update", message: e instanceof Error ? e.message : String(e) });
    }
    return out;
  }

  /**
   * تسجيل تدخّل فعلي. لا يُنادى إلا بعد نجاح إرسال/إعمال حقيقي.
   * السجل append-only: لا update ولا delete.
   *
   * إن مُرِّر `id` فالمفتاح الأساسي الحتمي هو ما يمنع الازدواج: عمليتان
   * متزامنتان تأخذان decision واحدًا، وتفوز واحدة فقط بالمفتاح؛ الأخرى ترتد
   * عند 23505 وتُعتبر "سبق تسويتها" لا خطأً.
   */
  async recordIntervention(a: {
    id?: string;
    caseId: string;
    channel: string;
    sentAt?: number;
    couponRef?: string | null;
  }): Promise<boolean> {
    if (!this.guard()) return false;
    try {
      const supabase = this.createClient();
      const row: Record<string, unknown> = {
        case_id: a.caseId,
        channel: a.channel,
        sent_at: new Date(a.sentAt ?? Date.now()).toISOString(),
        coupon_ref: a.couponRef ?? null,
      };
      if (a.id) row.id = a.id;
      const { error } = await supabase.from(ATTEMPTS_TABLE).insert(row);
      if (error) {
        // 23505 = سبقتني دورة أخرى: نتيجة طبيعية لا خطأ.
        if (error.code === "23505") return false;
        this.onError({ op: "create", ...safeErrorMessage(error) });
        return false;
      }
      return true;
    } catch (e) {
      this.onError({ op: "create", message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  // ------------------------------------------------------------
  // سجل أحداث الحالة — recovery_case_events (append-only)
  // ------------------------------------------------------------

  /**
   * إضافة حدث واحد للحالة.
   *
   * append-only بلا update ولا delete: لا corrected ولا تصحيح يدوي.
   * إن لم يكن الجدول موجودًا (migration-037 غير مُطبَّقة) تفشل الكتابة
   * بهدوء وتُرجع false: السجل طبقة عرض ولا يجوز أن يوقف مسار الإرسال.
   */
  async appendCaseEvent(e: {
    caseId: string;
    eventType: RecoveryCaseEventType;
    stageKey?: string | null;
    templateId?: number | null;
    summaryAr?: string | null;
    payload?: Record<string, unknown> | null;
  }): Promise<boolean> {
    if (!this.guard()) return false;
    if (!e.caseId || !e.eventType) return false;
    try {
      const { error } = await this.createClient().from(EVENTS_TABLE).insert({
        case_id: e.caseId,
        event_type: e.eventType,
        stage_key: e.stageKey ?? null,
        template_id: e.templateId ?? null,
        summary_ar: (e.summaryAr ?? "").slice(0, 500),
        payload: e.payload ?? {},
      });
      if (error) {
        this.onError({ op: "create", ...safeErrorMessage(error) });
        return false;
      }
      return true;
    } catch (err) {
      this.onError({ op: "create", message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /**
   * قراءة أحداث الحالات. السجل غير موجود ⇒ خريطة فارغة (fail-closed).
   */
  async listCaseEvents(caseIds?: string[]): Promise<Map<string, RecoveryCaseEvent[]>> {
    const out = new Map<string, RecoveryCaseEvent[]>();
    if (!this.guard()) return out;
    try {
      let query = this.createClient()
        .from(EVENTS_TABLE)
        .select("id, case_id, event_type, stage_key, template_id, summary_ar, payload, created_at")
        .order("created_at", { ascending: true })
        .limit(1000);
      if (caseIds && caseIds.length) query = query.in("case_id", caseIds);
      const { data } = await query;
      for (const row of (data as Record<string, unknown>[]) || []) {
        const event = eventFromRow(row);
        if (!event) continue;
        const list = out.get(event.caseId) ?? [];
        list.push(event);
        out.set(event.caseId, list);
      }
    } catch (e) {
      this.onError({ op: "update", message: e instanceof Error ? e.message : String(e) });
    }
    return out;
  }
}

/** تحويل صف recovery_case_events إلى RecoveryCaseEvent (يتجاهل الصفوف الناقصة). */
export function eventFromRow(row: Record<string, unknown>): RecoveryCaseEvent | null {
  const caseId = String(row.case_id ?? "");
  const eventType = String(row.event_type ?? "") as RecoveryCaseEventType;
  if (!caseId || !RECOVERY_CASE_EVENT_TYPES.includes(eventType)) return null;
  const createdAt = epochOrZero(row.created_at);
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
  return {
    id: String(row.id ?? `${caseId}:${eventType}:${createdAt}`),
    caseId,
    eventType,
    stageKey: row.stage_key ? String(row.stage_key) : null,
    templateId: row.template_id === null || row.template_id === undefined ? null : Number(row.template_id),
    summaryAr: String(row.summary_ar ?? ""),
    payload,
    createdAt,
  };
}


function epoch(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : new Date(String(v)).getTime();
  return Number.isFinite(n) ? n : null;
}

function epochOrZero(v: unknown): number {
  return epoch(v) ?? 0;
}

/**
 * خريطة (field -> column) لـ RecoveryCase — كل الحقول عدا id.
 * تُستخدم في المسارين الكامل والجزئي حتى لا تتفرّع أسماء الأعمدة.
 */
const COLUMNS = {
  customerId: "customer_id",
  customerPhone: "customer_phone",
  visitorId: "visitor_id",
  sessionId: "session_id",
  caseType: "case_type",
  status: "status",
  score: "score",
  cartValue: "cart_value",
  productIds: "product_ids",
  preferredProductId: "preferred_product_id",
  preferredProductSlug: "preferred_product_slug",
  firstDetectedAt: "first_detected_at",
  lastActivityAt: "last_activity_at",
  lastMessageAt: "last_message_at",
  messageCount: "message_count",
  discountCount: "discount_count",
  lastDiscountAt: "last_discount_at",
  nextActionAt: "next_action_at",
  lastReminderStep: "last_reminder_step",
  completedAt: "completed_at",
  purchaseRef: "purchase_ref",
  discountRef: "discount_ref",
  suppressReason: "suppress_reason",
  decision: "decision",
  decidedAt: "decided_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies Record<Exclude<keyof RecoveryCase, "id">, string>;

/**
 * حقول الأوقات: رقم (ms) → ISO string (timestamptz). null يبقى null.
 * يجب أن تشمل كل حقل من نوع number يمثّل وقتًا، وإلا أرسلنا رقمًا لعمود timestamptz.
 */
const TIME_FIELDS = new Set<keyof RecoveryCase>([
  "firstDetectedAt",
  "lastActivityAt",
  "lastMessageAt",
  "lastDiscountAt",
  "nextActionAt",
  "completedAt",
  "decidedAt",
  "createdAt",
  "updatedAt",
]);

/**
 * F1: تحويل partial patch إلى صف يحتوي الحقول الموجودة فقط.
 *
 * سبب وجوده: `update()` كان يبني صفًا كاملًا من emptyRow + patch، فأي patch
 * جزئي (مثل الإغلاق عند الشراء) كان يمسح visitor_id/session_id/case_type/
 * score/cart_value/product_ids ويُسقط التواريخ إلى 1970. الآن: الحقول
 * غير المذكورة في الـpatch لا تُرسل إطلاقًا، فتبقى كما هي في قاعدة البيانات.
 *
 * ملاحظة: `undefined` = "لم يُحدَّث" (يُتجاهل). `null` = "امسح القيمة" (يُرسل).
 */
export function casePatchToRow(patch: Partial<RecoveryCase>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch) as [keyof RecoveryCase, unknown][]) {
    if (key === "id") continue; // id يُستعمل في .eq() فقط — لا يُرسل كقيمة
    if (value === undefined) continue;
    const column = COLUMNS[key as Exclude<keyof RecoveryCase, "id">];
    if (!column) continue; // مفتاح غير معروف — يُتجاهل بأمان
    row[column] = TIME_FIELDS.has(key) && typeof value === "number" ? new Date(value).toISOString() : value;
  }
  return row;
}

export function caseToRow(c: RecoveryCase): Record<string, unknown> {
  return { id: c.id || newCaseId(), ...casePatchToRow(c) };
}

export function rowToCase(row: Record<string, unknown>): RecoveryCase {
  return {
    id: String(row.id ?? ""),
    customerId: row.customer_id ? String(row.customer_id) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    visitorId: String(row.visitor_id ?? ""),
    sessionId: String(row.session_id ?? ""),
    caseType: (row.case_type as RecoveryCase["caseType"]) || "ADD_TO_CART",
    status: (row.status as RecoveryCase["status"]) || "OPEN",
    score: Number(row.score ?? 0),
    cartValue: row.cart_value === null || row.cart_value === undefined ? null : Number(row.cart_value),
    productIds: Array.isArray(row.product_ids) ? (row.product_ids as string[]) : [],
    preferredProductId: row.preferred_product_id ? String(row.preferred_product_id) : null,
    preferredProductSlug: row.preferred_product_slug ? String(row.preferred_product_slug) : null,
    firstDetectedAt: epochOrZero(row.first_detected_at),
    lastActivityAt: epochOrZero(row.last_activity_at),
    lastMessageAt: epoch(row.last_message_at),
    messageCount: Number(row.message_count ?? 0),
    discountCount: Number(row.discount_count ?? 0),
    lastDiscountAt: epoch(row.last_discount_at),
    nextActionAt: epoch(row.next_action_at),
    lastReminderStep: Number(row.last_reminder_step ?? 0),
    completedAt: epoch(row.completed_at),
    purchaseRef: row.purchase_ref ? String(row.purchase_ref) : null,
    discountRef: row.discount_ref ? String(row.discount_ref) : null,
    suppressReason: row.suppress_reason ? String(row.suppress_reason) : null,
    decision: row.decision ? (row.decision as RecoveryCase["decision"]) : null,
    decidedAt: epoch(row.decided_at),
    createdAt: epochOrZero(row.created_at),
    updatedAt: epochOrZero(row.updated_at),
  };
}
"use strict";

/**
 * ما هذا؟
 * سيرفر QR لإشعارات واتساب — برنامج Node صغير يعمل باستمرار على جهازك،
 * يقترن بحساب واتساب عبر مسح رمز QR، ثم يلتقط إشعارات المتجر (للمدير)
 * من قاعدة البيانات ويرسلها لك عبر واتساب.
 *
 * طريقة العمل:
 *  1) تُشغّل البرنامج → يظهر رمز QR في الطرفية → تمسحه برقمك.
 *  2) البرنامج يبقى متصلاً ويفحص كل بضع ثوانٍ جدول notification_deliveries
 *     بحثاً عن إشعارات قناة whatsapp (التي سجّلها المتجر ولا يعالجها الخادم).
 *  3) يرسل الرسالة لرقمك (adminNumber) أو لرقم العميل إن وُجد.
 *  4) يحدّث حالة التسليم في قاعدة البيانات (sent / failed / ...).
 *  5) يكتب حالة اتصاله في إعدادات القناة داخل قاعدة البيانات ليراقبها
 *     صاحب المتجر من لوحة التحكم (المتصل/غير متصل/رقم/آخر اتصال).
 *  6) يوفّر خادم HTTP محلي (افتراضي بورت 8788) لعرض الحالة ورمز QR
 *     ولمسح سريع من لوحة التحكم:  /health  و  /qr  و  /
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
let qrcode = null;
try {
  qrcode = require("qrcode");
} catch {
  // اختياري: تنزيل صورة رمز QR لصفحة الويب
}

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "config.json");
const QR_FILE = path.join(ROOT, "qr.txt");

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    file = {};
  }
  return {
    supabaseUrl: process.env.SUPABASE_URL || file.supabaseUrl || "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || file.supabaseServiceRoleKey || "",
    adminNumber: process.env.ADMIN_NUMBER || file.adminNumber || "",
    bridgeApiKey: process.env.BRIDGE_API_KEY || file.bridgeApiKey || "",
    httpPort: Number(process.env.HTTP_PORT || file.httpPort || 8788),
    pollSeconds: Number(process.env.POLL_SECONDS || file.pollSeconds || 10),
    sessionDir: process.env.SESSION_DIR || file.sessionDir || path.join(ROOT, "auth-info"),
  };
}

const config = loadConfig();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Supabase (REST عبر fetch المدمج في Node — بلا حزم إضافية)            */
/* ------------------------------------------------------------------ */

function supaHeaders() {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "luma-whatsapp-bridge",
  };
}

async function supaFetch(method, tableQuery, body) {
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/rest/v1/${tableQuery}`, {
    method,
    headers: supaHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(`${method} ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

/* إعدادات واتساب من لوحة التحكم (تُقرأ كل بضع ثوانٍ) */
let waSettings = {
  adminNumber: config.adminNumber,
  bridgeApiKey: config.bridgeApiKey,
};

async function refreshWaSettings() {
  try {
    const rows = await supaFetch("GET", "notification_channels?code=eq.whatsapp&select=config");
    const cfg = (rows && rows[0] && rows[0].config) || {};
    waSettings.adminNumber = cfg.admin_number || config.adminNumber;
    waSettings.bridgeApiKey = cfg.bridge_api_key || config.bridgeApiKey;
  } catch {
    // ابقِ على آخر قيمة معروفة
  }
}

/* كتابة حالة الاتصال في إعدادات القناة ليراها صاحب المتجر بلوحة التحكم */
async function reportStatus(patch) {
  try {
    const rows = await supaFetch("GET", "notification_channels?code=eq.whatsapp&select=config");
    const cfg = ((rows && rows[0] && rows[0].config) || {});
    const merged = Object.assign({}, cfg, patch, { updated_at: new Date().toISOString() });
    await supaFetch("PATCH", "notification_channels?code=eq.whatsapp", { config: merged });
  } catch (e) {
    log("[status] خطأ في تحديث الحالة:", (e && e.message) || e);
  }
}

function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* تحويل رقم لصيغة JID الخاصة بواتساب                                  */
/* ------------------------------------------------------------------ */

function normalizeNumber(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[^\d]/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (n.length === 9 && n.startsWith("5")) n = "966" + n; // 5xxxxxxxx
  if (n.length === 10 && n.startsWith("0")) n = "966" + n.slice(1); // 05xxxxxxxx
  if (!n.startsWith("966")) n = "966" + n; // افتراضياً سعودي
  if (!/^966[1-9]\d{8}$/.test(n)) return null;
  return `${n}@s.whatsapp.net`;
}

/* ------------------------------------------------------------------ */
/* واتساب                                                             */
/* ------------------------------------------------------------------ */

let sock = null;
let connected = false;
let starting = false;
let myPhone = null;

async function startWa() {
  if (starting) return;
  starting = true;
  try {
    let version;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined;
    }

    fs.mkdirSync(config.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "warn" }),
      printQRInTerminal: true,
      browser: ["LumaStore", "Chrome", "1.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        connected = false;
        log("امسح رمز QR المعروض بالأعلى برقم واتساب لتوصيل السيرفر.");
        try {
          fs.writeFileSync(QR_FILE, qr);
          log("احتُفظ بالرمز أيضاً في: qr.txt");
        } catch {}
        void reportStatus({ connected: "false", qr_state: "waiting_qr", last_seen: nowIso() });
      }
      if (connection === "open") {
        connected = true;
        let phone = null;
        try {
          const id = String((sock.user && sock.user.id) || "");
          phone = id.split(":")[0].split("@")[0] || null;
          myPhone = phone;
        } catch {}
        log("✅ متصل بالواتساب — يبدأ استقبال إشعارات المتجر (Poll)." + (phone ? " الرقم: " + phone : ""));
        void reportStatus({ connected: "true", qr_state: "connected", phone, last_seen: nowIso() });
      }
      if (connection === "close") {
        connected = false;
        const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
          ? lastDisconnect.error.output.statusCode
          : null;
        log("انقطع الاتصال بالواتساب، كود:", code);
        void reportStatus({ connected: "false", qr_state: code === DisconnectReason.loggedOut ? "logged_out" : "reconnecting", phone: myPhone, last_seen: nowIso() });
        if (code === DisconnectReason.loggedOut) {
          log("تم تسجيل الخروج — احذف مجلد auth-info ثم أعد التشغيل لمسح QR جديد.");
        } else {
          log("إعادة الاتصال خلال 5 ثوانٍ...");
          await sleep(5000);
          starting = false;
          void startWa();
        }
      }
    });
  } finally {
    starting = false;
  }
}

async function sendToWa(jid, text) {
  if (!sock || !connected) throw new Error("واتساب غير متصل");
  await sock.sendMessage(jid, { text });
  return true;
}

/* ------------------------------------------------------------------ */
/* معالجة إشعار واحد + حلقة الجلب                                      */
/* ------------------------------------------------------------------ */

async function fetchPendingDeliveries() {
  const iso = nowIso();
  const query =
    "notification_deliveries?select=id,attempt,max_attempts,status,notification_id," +
    "notifications(user_type,title,message,customer_id,order_id)" +
    `&channel=eq.whatsapp&status=in.(pending,failed)&next_attempt_at=lte.${iso}` +
    "&order=next_attempt_at.asc&limit=20";
  const rows = await supaFetch("GET", query);
  return rows || [];
}

async function claimDelivery(id) {
  const query =
    "notification_deliveries?id=eq." + id +
    "&select=id,attempt,max_attempts,status,notifications(user_type,title,message,customer_id,order_id)";
  return supaFetch("PATCH", query, {
    status: "sending",
    updated_at: nowIso(),
  });
}

async function settleDelivery(id, patch) {
  await supaFetch("PATCH", `notification_deliveries?id=eq.${id}`, patch);
}

async function fetchOrderPhone(orderId) {
  if (!orderId) return null;
  const rows = await supaFetch("GET", `orders?id=eq.${orderId}&select=customer_phone`);
  return rows && rows[0] ? rows[0].customer_phone : null;
}

async function processDelivery(d) {
  const n = d.notifications;
  if (!n) {
    await settleDelivery(d.id, {
      status: "permanent_failed",
      error_message: "الإشعار غير موجود",
      failed_at: nowIso(),
      updated_at: nowIso(),
    });
    return;
  }

  let jid;
  let label;
  if (n.user_type === "admin") {
    jid = normalizeNumber(waSettings.adminNumber);
    label = waSettings.adminNumber || "(بدون رقم)";
  } else {
    const orderPhone = await fetchOrderPhone(n.order_id);
    jid = normalizeNumber(orderPhone);
    label = orderPhone || "(بدون رقم)";
  }

  if (!jid) {
    await settleDelivery(d.id, {
      status: "permanent_failed",
      error_message: `لا يوجد رقم واتساب صالح للمستلم (${label})`,
      failed_at: nowIso(),
      updated_at: nowIso(),
    });
    log(`[delivery ${d.id}] تم تجاهله: لا يوجد رقم (${label})`);
    return;
  }

  const text = `${n.title}\n\n${n.message}`.trim();
  try {
    await sendToWa(jid, text);
    await settleDelivery(d.id, {
      status: "sent",
      attempt: d.attempt + 1,
      sent_at: nowIso(),
      error_message: null,
      error_code: null,
      failed_at: null,
      updated_at: nowIso(),
    });
    log(`[delivery ${d.id}] ✅ أُرسل إلى ${label}`);
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    const done = d.attempt + 1 >= (d.max_attempts || 4);
    if (done) {
      await settleDelivery(d.id, {
        status: "permanent_failed",
        attempt: d.attempt + 1,
        error_message: msg,
        failed_at: nowIso(),
        updated_at: nowIso(),
      });
    } else {
      await settleDelivery(d.id, {
        status: "failed",
        attempt: d.attempt + 1,
        error_message: msg,
        next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        updated_at: nowIso(),
      });
    }
    log(`[delivery ${d.id}] ❌ فشل الإرسال (${label}): ${msg}`);
  }
}

let polling = false;

async function pollOnce() {
  if (!connected || polling) return;
  polling = true;
  try {
    await refreshWaSettings();
    const pending = await fetchPendingDeliveries();
    for (const d of pending) {
      // قفل تفاؤلي: علامة sending تمنع أي معالج آخر من أخذ نفس الصف
      const claimed = await claimDelivery(d.id);
      if (!claimed || !claimed.length) continue;
      await processDelivery({
        id: claimed[0].id,
        attempt: claimed[0].attempt,
        max_attempts: claimed[0].max_attempts,
        notifications: claimed[0].notifications,
      });
    }
  } catch (e) {
    log("[poll] خطأ:", (e && e.message) || e);
  } finally {
    polling = false;
  }
}

/* ------------------------------------------------------------------ */
/* خادم HTTP محلي للوحة التحكم                                         */
/* ------------------------------------------------------------------ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...CORS });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...CORS });
  res.end(body);
}

function bearerKey(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

function isAuthed(req) {
  const key = waSettings.bridgeApiKey;
  if (!key) return true; // لا يوجد مفتاح مضبوط بعد — مفتوح على الشبكة المحلية
  return bearerKey(req) === key;
}

function readQrFile() {
  try {
    const qr = fs.readFileSync(QR_FILE, "utf8").trim();
    return qr || null;
  } catch {
    return null;
  }
}

async function qrPayload() {
  const qr = connected ? null : readQrFile(); // بعد الاتصال لا حاجة للرمز
  let qrPng = null;
  if (qr && qrcode) {
    try {
      qrPng = await qrcode.toDataURL(qr, { margin: 1, width: 280 });
    } catch {}
  }
  return { connected, phone: myPhone, qr, qr_png: qrPng, qr_state: connected ? "connected" : "waiting_qr" };
}

function startHttp() {
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = (req.url || "/").split("?")[0];
      if (urlPath.endsWith("/") && urlPath.length > 1) urlPath = urlPath.slice(0, -1);

      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }

      if (urlPath === "/health") {
        sendJson(res, 200, { ok: true, connected, phone: myPhone, last_seen: nowIso() });
        return;
      }

      if (urlPath === "/screen") {
        const p = await qrPayload();
        sendHtml(
          res,
          `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
            `<title>ربط واتساب — امسح الرمز</title><body style="font-family:Tahoma,sans-serif;background:#f8f6f1;margin:0;padding:24px">` +
            `<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:16px;padding:24px;text-align:center">` +
            `<h2 style="margin:0 0 4px;color:#111">ربط واتساب</h2>` +
            `<p style="margin:0 0 16px;color:#777;font-size:13px">امسح الرمز: واتساب ← الإعدادات ← الأجهزة المرتبطة</p>` +
            (p.connected
              ? `<p style="font-size:15px;color:#16a34a"><b>متصل بالواتساب</b></p>` +
                (p.phone ? `<p style="font-size:14px;color:#333">الرقم: <b dir="ltr">+${p.phone}</b></p>` : "")
              : p.qr_png
                ? `<img src="${p.qr_png}" alt="QR" style="width:100%;max-width:300px;border-radius:12px"/>` +
                  `<p style="margin-top:12px;color:#b45309;font-size:13px">الرمز يتحدث تلقائياً — اسرع بالمسح.</p>`
                : `<p style="color:#dc2626;font-size:13px">الرمز غير متوفر بعد — أعد التحميل بعد لحظة.</p>`) +
            `</div>` +
            (p.connected ? "" : `<script>setTimeout(()=>location.reload(),3000)</script>`) +
            `</body></html>`
        );
        return;
      }

      if (!isAuthed(req)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (urlPath === "/qr") {
        sendJson(res, 200, await qrPayload());
        return;
      }

      if (urlPath === "/" ) {
        sendHtml(
          res,
          `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
            `<title>سيرفر واتساب — حالة الاتصال</title><body style="font-family:Tahoma,sans-serif;background:#f8f6f1;margin:0;padding:24px">` +
            `<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:16px;padding:24px">` +
            `<h2 style="margin:0 0 4px;color:#111">حالة سيرفر واتساب</h2>` +
            `<p style="margin:0 0 16px;color:#777;font-size:13px">متجر لمعة للاكسسوارات المطلية</p>` +
            `<p style="font-size:14px">الحالة: <b style="color:${connected ? "#16a34a" : "#dc2626"}">${connected ? "متصل بالواتساب" : "غير متصل"}</b></p>` +
            (myPhone ? `<p style="font-size:14px">الرقم المتصل: <b dir="ltr">+${myPhone}</b></p>` : "") +
            (connected
              ? `<p style="font-size:13px;color:#777">السيرفر يتلقى إشعارات المتجر ويرسلها عبر واتساب.</p>`
              : `<p style="color:#b45309;font-size:13px">امسح رمز QR الظاهر في الطرفية (أو افتح /qr) برقم واتساب للاتصال.</p>`) +
            `</div></body></html>`
        );
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      sendJson(res, 500, { error: String((e && e.message) || e) });
    }
  });

  server.listen(config.httpPort, "0.0.0.0", () => {
    log(`🖥️  خادم الحالة يعمل على: http://localhost:${config.httpPort}  (افتحه للمتصفح)`);
    log(`   - الحالة: /health   - رمز QR: /qr`);
  });
  return server;
}

/* ------------------------------------------------------------------ */
/* تشغيل                                                              */
/* ------------------------------------------------------------------ */

(async function main() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    log("⚠️ راجع config.json (أنشئه من config.example.json) — مطلوب supabaseUrl وsupabaseServiceRoleKey.");
    process.exit(1);
  }
  if (!config.adminNumber) {
    log("⚠️ adminNumber غير مضبوط في config.json — يمكنك ضبطه من لوحة التحكم (إشعارات ← القنوات ← واتساب).");
  }
  log("بدء تشغيل سيرفر QR...");
  await refreshWaSettings();
  startHttp();
  await startWa();
  setInterval(pollOnce, Math.max(3, config.pollSeconds) * 1000);
  // ضربات نبض لتحديث "آخر اتصال" كل 30 ثانية أثناء الاتصال
  setInterval(() => {
    if (connected) void reportStatus({ connected: "true", qr_state: "connected", phone: myPhone, last_seen: nowIso() });
  }, 30_000);

  // نبضة ذاتية لكل SELF_PING_URL إن ضُبط — تُبقي السيرفر نشطاً على المنصات
  // التي تُسبت الخدمة عند الخمول (مثل Hugging Face Spaces المجاني).
  const selfPingUrl = process.env.SELF_PING_URL;
  if (selfPingUrl) {
    const selfPingSeconds = Math.max(60, Number(process.env.SELF_PING_INTERVAL || 300));
    log(`نبضة ذاتية كل ${selfPingSeconds} ثانية إلى ${selfPingUrl} (لمنع النوم)`);
    setInterval(() => {
      fetch(selfPingUrl, { headers: { "User-Agent": "luma-whatsapp-bridge" } }).catch(() => {});
    }, selfPingSeconds * 1000);
  }
  void pollOnce();

  process.on("SIGINT", () => {
    log("إيقاف...");
    if (sock) sock.end();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    if (sock) sock.end();
    process.exit(0);
  });
})();
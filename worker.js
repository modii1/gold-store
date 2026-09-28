/**
 * نقطة تشغيل مجدولة على Worker ‏gold-store.
 *
 * OpenNext يولّد ‎.open-next/worker.js‎ بحمولة fetch فقط، وCloudflare لا يستدعي
 * جدولة زمنية إلا عبر تصدير `scheduled` من نقطة الدخول. لذلك نغلّف حمولة
 * OpenNext كما هي ونضيف معالج الجدولة دون المساس بأي مسار طلب قائم.
 *
 * التكرار معرَّف في wrangler.jsonc → triggers.crons.
 */

import openNextWorker, { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

/**
 * إعادة تصدير صريحة لـ Durable Objects التي يصدّرها OpenNext.
 * جمع `default` وحده كان سيُسقط هذه الأصناف بصمت وتتعطل الطابور والتخزين المؤقت.
 */
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge };

/** مسار دورة الاستعادة — نفس نقطة الدخول الذي يستخدمه أي external scheduler. */
const RECOVERY_RUN_PATH = "/api/recovery/run";

const worker = {
	...openNextWorker,

	/**
	 * يُستدعى تلقائيًا من Cloudflare حسب الجدولة في wrangler.jsonc.
	 *
	 * الأمان:
	 *  - يمرّر x-cron-secret من البيئة، فلا يُفتح المسار أبدًا.
	 *  - إن كان CRON_SECRET غير معرّف ⇒ لا يُرسل أي طلب إطلاقًا (fail-closed).
	 *  - لا يمرر أي سر في الرابط أو السجل.
	 *  - لا يعالج شيئًا بنفسه: المسار الهدف يقرأ settings.recovery_enabled
	 *    ويتوقف كليًا عند OFF.
	 *  - أي خطأ يُبتلع حتى لا يُعطَّل الجدولة للدورات الأخرى.
	 */
	async scheduled(_event, env) {
		try {
			const secret = typeof env?.CRON_SECRET === "string" ? env.CRON_SECRET.trim() : "";
			if (!secret) {
				console.warn("[recovery-cron] CRON_SECRET غير معرّف — تخطّي الدورة (fail-closed).");
				return;
			}

			const self = env?.WORKER_SELF_REFERENCE;
			const fetchFn = typeof self?.fetch === "function" ? self.fetch.bind(self) : fetch;

			const res = await fetchFn(new URL(RECOVERY_RUN_PATH, "https://gold-store"), {
				method: "POST",
				headers: { "x-cron-secret": secret },
			});

			if (!res.ok) {
				console.warn(`[recovery-cron] دورة الاستعادة رجعت ${res.status}.`);
				return;
			}

			const body = await res.json().catch(() => null);
			if (body?.enabled === false) {
				console.log("[recovery-cron] مفتاح استعادة المبيعات OFF — لا معالجة.");
				return;
			}

			console.log(
				`[recovery-cron] دورة الاستعادة تمت: إغلاق=${body?.closedByPurchase ?? 0}، توصيات=${body?.plannedMessages ?? 0}.`
			);
		} catch (err) {
			console.error("[recovery-cron] فشل تنفيذ الدورة:", err instanceof Error ? err.message : String(err));
		}
	},
};

export default worker;

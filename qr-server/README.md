# سيرفر QR — إشعارات واتساب

سيرفر Node صغير يربط متجرك بواتساب **عبر مسح رمز QR** ويعمل كجسر إشعارات.
يقترن بحساب واتساب الخاص بك (يشبه واتساب ويب)، ثم يرسل لك إشعارات المتجر
(طلب جديد، دفع، شحنة...) لحظة وقوعها.

> ملاحظة: هذه الطريقة غير مبنية على API رسمي (وتسمى Baileys/web).
> يفضل تشغيلها على شيء متصل بالإنترنت دائماً: جهازك، أو **Oracle Cloud Always Free**
> (سيرفر مجاني مدى الحياة — انظر قسم النشر أدناه)، أو أي VPS.

## المتطلبات
- Node.js 18+ (يفضَّل أحدث).
- حساب واتساب على رقمك.

## الإعداد

```bash
cd qr-server
npm install
copy config.example.json config.json   # ثم عدّل config.json
```

في `config.json` ضع:

| المفتاح | المعنى |
| --- | --- |
| `supabaseUrl` | رابط مشروع Supabase (موجود مسبقاً بالمثال) |
| `supabaseServiceRoleKey` | مفتاح الخدمة `sb_secret_...` من `.env.local` |
| `adminNumber` | رقمك على واتساب بصيغة دولية، مثال: `9665xxxxxxxx` (اختياري — يُؤخذ من لوحة التحكم أيضاً) |
| `bridgeApiKey` | مفتاح سري يحمي خادم الحالة/QR (اختياري — يُؤخذ من لوحة التحكم أيضاً) |
| `httpPort` | بورت خادم الحالة المحلي (افتراضي 8788) |
| `pollSeconds` | سرعة الفحص (10 ثوانٍ افتراضية) |

> يمكنك إدارة هذه الإعدادات أيضاً من **لوحة التحكم ← الإشعارات ← القنوات ← واتساب**
> (رابط السيرفر، مفتاح السيرفر، رقم الإدارة). السيرفر يقرأها ويؤثر بها تلقائياً.

## التشغيل

```bash
cd qr-server
npm start
```

عند أول تشغيل يظهر **رمز QR** في الطرفية (ويُحفظ في `qr.txt`).
امسحه من واتساب (الإعدادات ← الأجهزة المرتبطة) وسيبقى السيرفر متصلاً.
تُحفظ الجلسة في مجلد `auth-info` — لا تشاركه ولا تحذفه.

افصل السيرفر/سجّل الخروج: احذف مجلد `auth-info` وأعد التشغيل لمسح QR جديد.

## خادم الحالة (للوحة التحكم)

أثناء التشغيل يفتح خادماً محلياً بسيطاً (افتراضي بورت 8788):
- `http://localhost:8788` — صفحة حالة/اتصال بالعربي.
- `http://localhost:8788/health` — بيانات JSON للحالة والرقم المتصل.
- `http://localhost:8788/qr` — رمز QR الحالي بصيغة JSON + صورة PNG (للعرض في لوحة التحكم).

إن ضبطت `bridgeApiKey` (أو من لوحة التحكم) فيُطلب المفتاح لفتح `/qr` والصفحة الرئيسية.

## ربط المتجر

بعد تشغيل السيرفر:
1. لوحة التحكم ← **الإشعارات ← القنوات** ← فعّل قناة **واتساب** واملأ:
   - **رابط سيرفر الواتساب (QR)**: مثل `http://192.168.1.5:8788`
   - **مفتاح سيرفر الواتساب**: نفس `bridgeApiKey` في `config.json`
   - **رقم واتساب الإدارة**: الرقم الذي تستقبل عليه إشعارات المدير
2. في تبويب **القواعد** فعّل «واتساب» للقواعد التي تريدها (مثل: طلب جديد، تم الدفع، تم إنشاء الشحنة...).
3. الإشعارات التي تخص **المدير** تصل إلى رقم الإدارة. إشعارات العميل تصل لرقم الهاتف المسجّل في الطلب إن وُجد.
4. عند الحاجة لإيقاف كل الإشعارات مؤقتاً: **لوحة التحكم ← الإشعارات ← إيقاف مؤقت**.

## النشر على Oracle Cloud Always Free (سيرفر مجاني مدى الحياة)

بديل عن تشغيل السيرفر على جهازك: VM صغيرة على Oracle **لا تُحتسب رسومها أبداً**
وتعمل 24/7 على الإنترنت. الخطوات:

### 1) إنشاء الحساب
- اشترك في `cloud.oracle.com` (اختر **Free Tier**). يطلب بطاقة للتحقق من الهوية
  لكنه **لا يخصم** شيئاً ما دمت ضمن حد Always Free.
- اذهب إلى **Compute → Instances → Create instance**:
  - الصورة: **Ubuntu 24.04 Minimal**.
  - الشكل: **VM.Standard.E2.1.Micro** (1 OCPU اتوماتيكياً / 1GB، مجاني دائماً).
    (إن لم يظهر، جرّب منطقة أخرى. شكل ARM المجاني **يُرفض غالباً** لضيق السعة.)
  - القرص: 50GB (مجاني)، حدّد **Always Free eligible**.
  - أضف مفتاح SSH العام (أو استخدم خيار إنشاء مفتاح وتنزيل الخاص).
  - أنشئ، وانسخ **Public IP address** عند الظهور.

### 2) فتح بورت 8788 (خطوة حاسمة)
Oracle يغلق كل الداخل افتراضياً:
- **VCN → Security Lists** ← القائمة الافتراضية ← **Add Ingress Rule**:
  - `Source CIDR: 0.0.0.0/0` ، `IP Protocol: TCP` ، `Destination Port: 8788`.

### 3) الدخول ونسخ الملفات
```bash
ssh -i ~/.ssh/ora_key ubuntu@<PUBLIC_IP>
```
من جهازك (حيث المشروع)، انسخ مجلد `qr-server` **بدون** `node_modules/auth-info/config.json`
(تُبنى أعلاه من الصورة):
```bash
rsync -av --exclude node_modules --exclude auth-info --exclude config.json \
       --exclude qr.txt --exclude .env qr-server ubuntu@<PUBLIC_IP>:~/
```
(إن لم تجد `rsync`، انسخ الملفات الأربعة يدوياً: `index.js`، `package.json`،
`package-lock.json`، `Dockerfile`، `docker-compose.yml`، `.env.example`).

### 4) تثبيت Docker وتشغيل السيرفر
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# سجّل خروج وأدخل ثانيةً (أو: newgrp docker)
cd ~/qr-server
cp .env.example .env
nano .env        # ضع قيمك الحقيقية
docker compose up -d --build
docker compose logs -f     # انتظر ظهور رمز QR
```

### 5) ربط الجهاز بمسح QR
- من لوحة التحكم: **الإشعارات ← القنوات ← واتساب** واجعل:
  - **رابط سيرفر الواتساب (QR)** = `http://<PUBLIC_IP>:8788`
  - **مفتاح سيرفر الواتساب** = نفس `BRIDGE_API_KEY` في `.env`
  - **رقم واتساب الإدارة** كالمعتاد.
- اضغط **عرض رمز QR** في اللوحة ← امسحه من واتساب
  (الإعدادات ← الأجهزة المرتبطة). ستتحول الحالة إلى **متصل** تلقائياً.
- الجلسة محفوظة في وحدة (volume) `wa-session` — تبقى عبر إعادة البناء/التحديثات.

### ملاحظات مهمة للسيرفر السحابي
- **نسخة احتياطية للجلسة** بين فترة وأخرى (لاستعادة بلا إعادة مسح):
  ```bash
  docker compose exec whatsapp-bridge tar -C /app -czf - auth-info > wa-session.tar.gz
  ```
- **تذكير**: Oracle يسترجع أحياناً آلات Always Free «الخاملة» (7 أيام بلا نشاط).
  سيرفرنا يفحص قاعدة البيانات كل 10 ثوانٍ ويرسل نبضة كل 30 ثانية → نشاط شبكة مستمر
  يمنع عادةً اعتباره خاملاً.
- لتحديث السيرفر لاحقاً: سحب آخر `index.js` ثم `sudo docker compose up -d --build`.
- `docker compose logs -f` يعرض أيضاً `qr.txt` بالداخل — لكن الأسهل مسحه من اللوحة عن طريق «عرض رمز QR».

## النشر على Google Cloud e2-micro (مجاني مدى الحياة)

بديل عن Oracle، بنفس الوعد تقريباً: جهاز صغير **دائم التشغيل ومجاني للأبد** — مؤكد رسمياً
(1 جهاز `e2-micro` في إحدى المناطق `us-west1`/`us-central1`/`us-east1` + قرص 30GB + خروج 1GB/شهر).

### 1) الحساب
- اشترك في `cloud.google.com` ← **Start free** (تجربة 90 يوماً بـ $300 + الوصول للفئة المجانية).
  سيتطلب بطاقة للتحقق **بتثبيت مؤقت 0–1$ يُحرَّر، لا يُخصم**.
- **مهمة جداً**: قبل انتهاء الـ 90 يوم اضغط **Activate** (الترقية إلى حساب فوترة عادي)
  في واجهة الترحيب وإلا تُغلق الموارد وتُحذف. البقاء داخل الفئة المجانية = **بلا أي فاتورة**.

### 2) إنشاء الجهاز (من Cloud Shell المجاني في الكونسول — بلا تثبيت أي شيء)
```bash
gcloud config set compute/zone us-central1-a

gcloud compute instances create whatsapp-bridge \
  --machine-type=e2-micro \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard

# فتح بورت لوحة الحالة
gcloud compute firewall-rules create whatsapp-bridge-8788 \
  --allow=tcp:8788 --source-ranges=0.0.0.0/0 \
  --description="WhatsApp bridge status panel"
```

### 3) الدخول وتثبيت Docker
```bash
gcloud compute ssh whatsapp-bridge   # من نفس Cloud Shell

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # أو سجّل خروج/دخول
```

### 4) سحب ملفات المشروع وتشغيله
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/modii1/gold-store.git
cd gold-store/qr-server
cp .env.example .env
nano .env        # ضع قيمك الحقيقية
docker compose up -d --build
docker compose logs -f        # انتظر رمز QR
```

### 5) ربط اللوحة بالجهاز
احصل على الـ IP العام:
```bash
gcloud compute instances describe whatsapp-bridge \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```
ثم من لوحة التحكم: **الإشعارات ← القنوات ← واتساب**:
- **رابط سيرفر الواتساب (QR)** = `http://<IP>:8788`
- **مفتاح السيرفر** = نفس `BRIDGE_API_KEY` في `.env`
- اضغط **عرض رمز QR** ← امسح الرمز من واتساب.

### ملاحظات مهمة
- **IP العام مؤقت (ephemeral)** وغير خاضع للفوترة إطلاقاً. لو تغيّر بعد إعادة تشغيل الجهاز،
  حدّث `bridge_url` من اللوحة بالقيمة الجديدة.
- لحماية لوحة الحالة من الإنترنت: أبقِ `BRIDGE_API_KEY` مضبوطاً — فعندها يتطلب `/qr`
  مفتاحاً. (الخيار الأشد أماناً: حصر `--source-ranges` على IP حلقة الاتصال المنزلية/الثابت.)
- القرص 30GB يكفي؛ لا تصعد لقرص أكبر وإلا تجاوزت الفئة المجانية.
- ملفات النشر (`Dockerfile`/`docker-compose.yml`) هي نفسها في أوراكل — نقل الجلسة بينهما
  بنسخ مجلد `auth-info` (تعمل من مكان واحد فقط).

## ملاحظات تشغيلية
- لا تعمل هذه الطريقة على Cloudflare Workers أو Vercel (السيرفر يحتاج اتصالاً مستمراً)؛ لذلك شغّله على جهازك أو VPS مجاني مدى الحياة (انظر أعلاه).
- يمكنك نقل السيرفر بين أي جهاز/VPS بنفس المجلد و`auth-info` (نسخة الجلسة تعمل من مكان واحد فقط).
- لا تُرسل إشعارات واتساب في وضع «إيقاف مؤقت» للقنوات.
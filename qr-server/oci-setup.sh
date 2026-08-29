#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  سكربت إعداد كامل على Oracle Cloud Always Free (تشغيل مرة واحدة
#  من OCI Cloud Shell): شبكة + فتح بورت 8788 + جهاز Ubuntu مجاني
#  + تثبيت Docker + تشغيل جسر واتساب.
#
#  عدّل القيم الثلاث أسفله فقط ثم ألصق الملف كله في Cloud Shell.
# ═══════════════════════════════════════════════════════════════
set -e

SUPABASE_SERVICE_ROLE_KEY="sb_secret_ضع_المفتاح_هنا"   # من ملف .env.local عندك
ADMIN_NUMBER="9665xxxxxxxx"                            # رقمك على واتساب
BRIDGE_API_KEY="ضع_اي_مفتاح_سري_عشوائي"                # احتفظ به للوحة

echo "1/6 إنشاء الشبكة (VCN + بوابة إنترنت + شبكة فرعية عامة) ..."
T=$(oci iam tenancy list --query "data[0].id" --raw-output)
AD=$(oci iam availability-domain list --compartment-id "$T" --query "data[0].name" --raw-output)

VCN=$(oci network vcn create --cidr-block "10.0.0.0/16" --display-name "vcn-wa" --compartment-id "$T" --query "data.id" --raw-output)
for _ in $(seq 1 15); do state=$(oci network vcn get --vcn-id "$VCN" --query 'data."lifecycle-state"' --raw-output); [ "$state" = "AVAILABLE" ] && break; sleep 5; done

GW=$(oci network internet-gateway create --is-enabled true --vcn-id "$VCN" --compartment-id "$T" --display-name "igw-wa" --query "data.id" --raw-output)
RT=$(oci network route-table list --compartment-id "$T" --vcn-id "$VCN" --query "data[0].id" --raw-output)
oci network route-table update --route-table-id "$RT" --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$GW\"}]" --force >/dev/null

SUB=$(oci network subnet create --cidr-block "10.0.0.0/24" --vcn-id "$VCN" --compartment-id "$T" --display-name "sub-wa" --route-table-id "$RT" --query "data.id" --raw-output)

SL=$(oci network security-list list --compartment-id "$T" --vcn-id "$VCN" --query "data[0].id" --raw-output)
oci network security-list update --security-list-id "$SL" \
  --ingress-security-rules '[{"source":"0.0.0.0/0","protocol":"all"}]' \
  --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all"}]' --force >/dev/null
echo "✅ الشبكة جاهزة"

echo "2/6 توليد مفتاح SSH ..."
[ -f ~/.ssh/id_rsa ] || ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/id_rsa -q
PUB=$(cat ~/.ssh/id_rsa.pub)

echo "3/6 إنشاء الجهاز المجاني (A1.Flex 1OCPU/6GB) وانتظار تشغيله ..."
IMG=$(oci compute image list --compartment-id "$T" --operating-system "Canonical Ubuntu" --query "data[? contains(\"display-name\",'24.04')]|sort_by(@,&\"time-created\")[-1].id" --raw-output)
INS=$(oci compute instance launch \
  --availability-domain "$AD" --compartment-id "$T" --shape "VM.Standard.A1.Flex" \
  --shape-config '{"ocpus":1,"memoryInGBs":6}' \
  --display-name "whatsapp-bridge" --image-id "$IMG" --subnet-id "$SUB" \
  --metadata "{\"ssh_authorized_keys\":\"$PUB\"}" --query "data.id" --raw-output)
for _ in $(seq 1 30); do st=$(oci compute instance get --instance-id "$INS" --query 'data."lifecycle-state"' --raw-output); echo "   حالة الجهاز: $st"; [ "$st" = "RUNNING" ] && break; sleep 10; done

IP=$(oci compute instance list-vnics --instance-id "$INS" --query 'data[0]."public-ip"' --raw-output)
echo "✅ جهازك جاهز على: $IP"

echo "4/6 تثبيت Docker وسحب المشروع ..."
ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ubuntu@"$IP" "sudo apt-get update -qq >/dev/null 2>&1; curl -fsSL https://get.docker.com | sudo sh -s -- >/dev/null 2>&1; sudo usermod -aG docker ubuntu; sudo apt-get install -y -qq docker-compose-plugin git >/dev/null 2>&1; git clone -q https://github.com/modii1/gold-store.git /tmp/gold-store 2>/dev/null || git -C /tmp/gold-store pull -q"

echo "5/6 كتابة متغيرات الجسر ..."
cat > /tmp/.env <<EOT
SUPABASE_URL=https://urofqjjfushrurnykgec.supabase.co
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ADMIN_NUMBER=$ADMIN_NUMBER
BRIDGE_API_KEY=$BRIDGE_API_KEY
HTTP_PORT=8788
POLL_SECONDS=10
EOT
scp -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no /tmp/.env ubuntu@"$IP":/tmp/gold-store/qr-server/.env

echo "6/6 تشغيل الجسر ..."
ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ubuntu@"$IP" "cd /tmp/gold-store/qr-server && sudo docker compose up -d --build"

echo "=============================================="
echo "✅ كل شيء جاهز!"
echo "   رابط الجسر (لوحة التحكم):  http://$IP:8788"
echo "   مفتاح السيرفر:               $BRIDGE_API_KEY"
echo "   معاينة الحالة:               http://$IP:8788/health"
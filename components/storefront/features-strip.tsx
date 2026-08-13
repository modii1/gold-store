import { Truck, ShieldCheck, Gem, MessagesSquare } from "lucide-react";

const items = [
  { icon: Truck, title: "توصيل لجميع المدن", desc: "شحن سريع وآمن داخل المملكة" },
  { icon: ShieldCheck, title: "دفع آمن", desc: "تحويل بنكي أو الدفع عند الاستلام" },
  { icon: Gem, title: "جودة مضمونة", desc: "معاينة دقيقة لكل قطعة قبل الشحن" },
  { icon: MessagesSquare, title: "دعم واتساب", desc: "فريقنا جاهز للرد على استفساراتك" },
];

export function FeaturesStrip() {
  return (
    <section className="border-b border-sand bg-ivory">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 md:grid-cols-4 md:px-6 md:py-10">
        {items.map((item) => (
          <div key={item.title} className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream text-gold-dark">
              <item.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-ink">{item.title}</p>
              <p className="mt-0.5 text-xs text-stone-500">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

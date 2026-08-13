import Link from "next/link";
import { ArrowRight, Gem, ShieldCheck, Truck, MessagesSquare } from "lucide-react";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Branding panel (right in RTL) */}
      <aside className="relative hidden overflow-hidden bg-ink lg:flex flex-col justify-between p-12 xl:p-16">
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-gold-dark/20 blur-3xl" />
        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-2 text-ivory">
            <Gem className="h-6 w-6 text-gold-light" />
            <span className="text-xl font-bold tracking-wide">لمعة</span>
          </Link>
        </div>

        <div className="relative">
          <p className="text-gold-light text-sm font-semibold tracking-[0.35em] uppercase">Luxury Accessories</p>
          <h2 className="mt-4 text-4xl xl:text-5xl font-bold leading-tight text-ivory">
            تفاصيل تليق<br />بذوقكِ الراقي
          </h2>
          <p className="mt-4 max-w-md text-ivory/70 font-light leading-relaxed">
            قطع مختارة بعناية من الإكسسوارات المطلية بالذهب — انضمي إلى عالمنا لتتتبعي طلباتك وتجربي تسوقاً سلساً.
          </p>
          <div className="mt-10 space-y-4">
            {[
              { icon: Truck, text: "توصيل سريع لجميع المدن" },
              { icon: ShieldCheck, text: "دفع آمن ومضمون" },
              { icon: MessagesSquare, text: "دعم فوري عبر واتساب" },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-3 text-ivory/80">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 border border-gold/30 text-gold-light">
                  <f.icon className="h-4 w-4" />
                </span>
                <span className="text-sm">{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-ivory/40">© {new Date().getFullYear()} لمعة — جميع الحقوق محفوظة</p>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center bg-ivory px-4 py-12 lg:px-8">
        <div className="w-full max-w-md slide-up">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-stone-500 hover:text-gold transition lg:hidden">
            <ArrowRight className="h-4 w-4" /> لمعة
          </Link>

          <h1 className="text-2xl md:text-3xl font-bold text-ink">{title}</h1>
          <p className="mt-2 text-sm text-stone-500">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-6">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

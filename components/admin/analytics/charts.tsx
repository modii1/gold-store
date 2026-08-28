"use client";

import { useState } from "react";

/** Minimal SVG area/line chart for orders or sales over time. */
export function TrendChart({
  data,
  format,
}: {
  data: { label: string; value: number }[];
  format: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 620;
  const H = 220;
  const PAD = { top: 16, right: 12, bottom: 28, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (data.length === 0) {
    return <EmptyChart />;
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const min = 0;
  const step = innerW / Math.max(1, data.length - 1);
  const x = (i: number) => PAD.left + i * step;
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

  const points = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const areaPoints = `${PAD.left},${PAD.top + innerH} ${points} ${x(data.length - 1)},${PAD.top + innerH}`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#B08D57" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#B08D57" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const v = max * f;
          const gy = y(v);
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={gy} y2={gy} className="stroke-stone-200" strokeWidth={1} strokeDasharray="3 4" />
              <text x={PAD.left - 6} y={gy + 3} textAnchor="end" className="fill-stone-400" fontSize={9}>
                {format(Math.round(v))}
              </text>
            </g>
          );
        })}
        <polygon points={areaPoints} fill="url(#trendFill)" />
        <polyline points={points} fill="none" stroke="#B08D57" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) =>
          i % Math.ceil(data.length / 12) === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-stone-400" fontSize={9}>
              {shortLabel(d.label)}
            </text>
          ) : null
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-stone-300" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(data[hover].value)} r={4} fill="#B08D57" stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-1/2 top-0 -translate-y-1/2 translate-x-1/2 rounded-lg border border-amber-100 bg-white px-2.5 py-1.5 text-center shadow-md" style={{ right: `${(x(hover) / W) * 100}%` }}>
          <p className="text-[10px] text-stone-400">{data[hover].label}</p>
          <p className="text-xs font-bold text-gold-dark">{format(data[hover].value)}</p>
        </div>
      )}
    </div>
  );
}

/** Horizontal bar list (e.g. funnel / sources / devices). */
export function BarList({ rows, format }: { rows: { label: string; value: number; hint?: string }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <EmptyChart />;
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-stone-600">{r.label}</span>
            <span className="font-bold text-gold-dark">{format(r.value)}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
            <div className="h-full rounded-full bg-gradient-to-l from-gold to-gold-dark transition-all duration-500" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          {r.hint && <p className="mt-0.5 text-[10px] text-stone-400">{r.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function EmptyChart() {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-sand bg-cream/40 text-sm text-stone-400">
      لا توجد بيانات في هذه الفترة
    </div>
  );
}

function shortLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
}

export function rangeLabel(range: "today" | "7d" | "30d") {
  if (range === "today") return "اليوم";
  if (range === "7d") return "آخر 7 أيام";
  return "آخر 30 يوم";
}

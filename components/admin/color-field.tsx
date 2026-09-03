"use client";

import { useState } from "react";

export function ColorField({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div>
      <label className="block text-sm font-semibold text-stone-700 mb-1">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 focus-within:border-gold focus-within:ring-2 focus-within:ring-gold/20">
        <input type="color" value={value} onChange={(e) => setValue(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded border-0 p-0" />
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)}
          dir="ltr" className="min-w-0 flex-1 bg-transparent text-sm text-stone-600 focus:outline-none" />
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

export default function OrdersLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="h-7 w-32 animate-pulse rounded-lg bg-stone-200" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-stone-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 animate-pulse rounded-lg bg-stone-200" />
          <div className="h-9 w-24 animate-pulse rounded-lg bg-stone-200" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-stone-200" />
        ))}
      </div>

      <div className="flex gap-3">
        <div className="h-11 flex-1 animate-pulse rounded-xl bg-stone-200" />
        <div className="h-11 w-40 animate-pulse rounded-xl bg-stone-200" />
        <div className="h-11 w-40 animate-pulse rounded-xl bg-stone-200" />
      </div>

      <div className="h-96 animate-pulse rounded-2xl bg-stone-100" />
    </div>
  );
}

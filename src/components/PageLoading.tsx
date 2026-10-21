export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 xl:px-6" aria-busy="true" aria-live="polite">
      <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="nav-progress h-full w-1/3 rounded-full bg-navy" />
      </div>
      <p className="mt-4 text-sm font-medium text-slate-600">{label}</p>
      <div className="mt-6 space-y-3">
        <div className="h-8 w-48 animate-pulse rounded-md bg-slate-200" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

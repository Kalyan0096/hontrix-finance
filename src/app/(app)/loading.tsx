/** Shown instantly while a screen loads, so tapping a menu item always gives feedback. */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-5">
      <div className="skel h-9 w-56" />
      <div className="skel h-44 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="skel h-28" />)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

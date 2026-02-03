export function StatCard({ label, value, subtext, icon }) {
  return (
    <div className="glass-panel geo-frame border border-line border-l-2 border-l-accent p-5">
      {icon && <div className="mb-2 text-zinc-500">{icon}</div>}
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 font-mono text-xl tabular-nums text-white">{value}</p>
      {subtext && <p className="mt-1 text-xs text-zinc-500">{subtext}</p>}
    </div>
  )
}

export function StatCard({ label, value, subtext, icon }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {subtext && <p className="mt-1 text-xs text-slate-500">{subtext}</p>}
    </div>
  )
}

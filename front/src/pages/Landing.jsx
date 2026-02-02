import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getConfig } from '../contract/storageRegistryApi'

function formatRewardPerGb(nano) {
  if (nano === undefined || nano === null) return null
  const n = typeof nano === 'bigint' ? Number(nano) : nano
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} MAS`
  return `${(n / 1e9).toFixed(4)} MAS`
}

export function Landing() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getConfig()
      .then((c) => { if (!cancelled) setConfig(c) })
      .catch(() => { if (!cancelled) setConfig(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rewardPerGb = config?.rewardPerGbPerPeriod
  const pricingStr = rewardPerGb != null ? formatRewardPerGb(rewardPerGb) : null

  return (
    <div className="relative flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center overflow-hidden text-center">
      {/* Subtle gradient glow behind title */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(251,191,36,0.12),transparent)]"
        aria-hidden
      />
      <h1 className="font-mono text-5xl font-bold tracking-tight text-white drop-shadow-sm sm:text-6xl md:text-7xl lg:text-8xl">
        MASSA STORAGE
      </h1>
      <p className="mt-6 text-xl font-medium tracking-wide text-amber-400/95 sm:text-2xl md:text-3xl">
        The first yield storage platform
      </p>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
        Store your files in a decentralized way. Earn rewards for providing storage on the Massa network — stake, allocate capacity, and get paid in MAS.
      </p>
      {pricingStr && (
        <div className="mt-8 rounded-xl border border-slate-600/80 bg-slate-800/50 px-6 py-4">
          <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
            Storage pricing
          </p>
          <p className="mt-1 text-xl font-semibold text-amber-400">
            {pricingStr} <span className="text-slate-400">/ GB / period</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Same rate as node rewards — pay for storage, earn as a provider.
          </p>
        </div>
      )}
      {loading && !pricingStr && (
        <div className="mt-8 h-14 w-48 animate-pulse rounded-xl bg-slate-800/50" aria-hidden />
      )}
      <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
        <Link
          to="/dashboard"
          className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-6 py-3 text-sm font-semibold text-amber-400 transition hover:bg-amber-500/30"
        >
          View dashboard
        </Link>
        <Link
          to="/my-dashboard"
          className="rounded-lg border border-slate-600 bg-slate-800 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
        >
          My dashboard
        </Link>
      </div>
    </div>
  )
}

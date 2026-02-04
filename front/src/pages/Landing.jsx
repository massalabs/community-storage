import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getConfig,
  getCurrentPeriod,
  getPeriodStats,
  getStorageProviders,
} from '../contract/storageRegistryApi'

function toNum(v) {
  return typeof v === 'bigint' ? Number(v) : v
}

/** Affiche toujours en MAS (nanoMAS / 1e9). */
function formatMas(nano) {
  const n = toNum(nano)
  const mas = n / 1e9
  if (mas >= 1) return `${Math.floor(mas).toLocaleString('fr-FR')} MAS`
  if (mas > 0) return `${mas.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} MAS`
  return '0 MAS'
}

export function Landing() {
  const [config, setConfig] = useState(null)
  const [periodStats, setPeriodStats] = useState(null)
  const [totalAvailableGb, setTotalAvailableGb] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [cfg, currentPeriod] = await Promise.all([
          getConfig(),
          getCurrentPeriod(),
        ])
        if (cancelled) return
        setConfig(cfg)
        let stats = null
        try {
          stats = await getPeriodStats(currentPeriod)
          if (!cancelled) setPeriodStats(stats)
        } catch (e) {
          if (!cancelled) setPeriodStats(null)
        }
        try {
          const providers = await getStorageProviders()
          const sum = (providers || []).reduce((acc, p) => acc + toNum(p.availableGb ?? p.allocatedGb ?? 0), 0)
          if (!cancelled) setTotalAvailableGb(sum)
        } catch (e) {
          if (!cancelled) setTotalAvailableGb(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Erreur de chargement')
          setConfig(null)
          setPeriodStats(null)
          setTotalAvailableGb(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

  const storedGb = periodStats != null ? toNum(periodStats.totalGbStored) : null
  const rewardsMas = periodStats != null ? periodStats.totalRewardsDistributed : null

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col justify-center">
      <div className="mx-auto w-full max-w-4xl px-4">
        {/* Hero : titre + ligne + concept */}
        <div className="border-l-2 border-accent pl-8">
          <h1 className="font-mono text-6xl font-light tracking-tight text-white sm:text-7xl md:text-8xl lg:text-9xl">
            Massa Storage
          </h1>
          <div className="mt-8 h-px w-32 bg-line-strong" aria-hidden />
          <p className="mt-8 max-w-lg font-mono text-lg uppercase leading-relaxed tracking-wide text-zinc-500 sm:text-xl">
            Stockage décentralisé. Récompenses en MAS pour les providers.
          </p>
        </div>

        {/* Grille 3 colonnes : indicateurs */}
        <div className="mt-24 grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
          <div className="card-panel border-r border-b border-t border-line p-10 sm:border-b-0 sm:border-t">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-zinc-500">
              Poids stocké
            </p>
            <p className="mt-6 font-mono text-data-2xl tabular-nums text-white sm:text-data-xl">
              {loading ? '—' : storedGb != null ? `${storedGb.toLocaleString('fr-FR')} GB` : '—'}
            </p>
          </div>
          <div className="card-panel border-r border-b border-t border-line p-10 sm:border-b-0 sm:border-t">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-zinc-500">
              Poids dispo
            </p>
            <p className="mt-6 font-mono text-data-2xl tabular-nums text-white sm:text-data-xl">
              {loading ? '—' : totalAvailableGb != null ? `${totalAvailableGb.toLocaleString('fr-FR')} GB` : '—'}
            </p>
          </div>
          <div className="card-panel border-r border-b border-t border-line p-10 sm:border-b-0 sm:border-t">
            <p className="font-mono text-base font-medium uppercase tracking-wide text-zinc-500">
              Récompenses totales
            </p>
            <p className="mt-6 font-mono text-data-2xl tabular-nums text-accent sm:text-data-xl">
              {loading ? '—' : rewardsMas != null ? formatMas(rewardsMas) : '—'}
            </p>
          </div>
        </div>

        {error && !config && (
          <div className="mt-6 card-panel border-l-red-500/60 p-4">
            <p className="font-mono text-sm font-medium text-red-400/90">Erreur de chargement</p>
            <p className="mt-1 text-sm text-zinc-400">{error}</p>
            <p className="mt-2 text-xs text-zinc-500">
              Vérifiez que le contrat est déployé sur le buildnet et que VITE_STORAGE_REGISTRY_ADDRESS est correct.
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-20 flex flex-wrap gap-10">
          <Link
            to="/upload"
            className="font-mono border border-line bg-surface px-10 py-5 text-lg font-medium uppercase tracking-wide text-white hover:border-accent hover:text-accent transition-colors"
          >
            Upload
          </Link>
          <Link
            to="/provide-storage"
            className="card-panel font-mono border border-line px-10 py-5 text-lg font-medium uppercase tracking-wide text-zinc-500 hover:border-line-strong hover:text-zinc-300 transition-colors"
          >
            Provide Storage
          </Link>
        </div>
      </div>
    </div>
  )
}

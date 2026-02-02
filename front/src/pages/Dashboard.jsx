import { useEffect, useState } from 'react'
import { StatCard } from '../components/StatCard'
import {
  getConfig,
  getTotalNodes,
  getCurrentPeriod,
  getPeriodStats,
} from '../contract/storageRegistryApi'

// Massa: ~32 slots × 16 s par période (à aligner avec la chaîne si besoin)
const SECONDS_PER_PERIOD = 512
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60
const PERIODS_PER_YEAR = Math.floor(SECONDS_PER_YEAR / SECONDS_PER_PERIOD)
const EXAMPLE_GB = 10

function toNum(v) {
  return typeof v === 'bigint' ? Number(v) : v
}

function formatNanoMas(nano) {
  const n = toNum(nano)
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR')} MAS`
  return `${n.toLocaleString('fr-FR')} nanoMAS`
}

function formatMs(ms) {
  const m = toNum(ms)
  if (m >= 60_000) return `${m / 60_000} min`
  return `${m / 1000} s`
}

export function Dashboard() {
  const [config, setConfig] = useState(null)
  const [totalNodes, setTotalNodes] = useState(null)
  const [periodStats, setPeriodStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [cfg, total, currentPeriod] = await Promise.all([
          getConfig(),
          getTotalNodes(),
          getCurrentPeriod(),
        ])
        if (cancelled) return
        setConfig(cfg)
        setTotalNodes(total)
        let stats = null
        try {
          stats = await getPeriodStats(currentPeriod)
          if (!cancelled) setPeriodStats(stats)
        } catch (e) {
          if (!cancelled) setPeriodStats(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Erreur de chargement')
          setConfig(null)
          setTotalNodes(null)
          setPeriodStats(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [])

  if (loading && !config) {
    return (
      <div className="space-y-10">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          Chargement des données du contrat…
        </div>
      </div>
    )
  }

  if (error && !config) {
    return (
      <div className="space-y-10">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p className="font-medium">Impossible de charger le contrat</p>
          <p className="mt-1 text-sm">{error}</p>
          <p className="mt-2 text-sm text-slate-400">
            Vérifiez que vous êtes sur buildnet et que l’adresse du contrat est correcte.
          </p>
        </div>
      </div>
    )
  }

  const rewardPerGb = config ? toNum(config.rewardPerGbPerPeriod) : 0
  const minStake = config ? toNum(config.minStake) : 1
  const minAllocatedGb = config ? toNum(config.minAllocatedGb) : 1
  const rewardPerGbPerYear = rewardPerGb * PERIODS_PER_YEAR
  const rewardPerYearMin = rewardPerGb * minAllocatedGb * PERIODS_PER_YEAR
  const apyPercent = minStake > 0 ? (rewardPerYearMin / minStake) * 100 : 0
  const exampleRewardPerYear = rewardPerGb * EXAMPLE_GB * PERIODS_PER_YEAR
  const apyExamplePercent = minStake > 0 ? (exampleRewardPerYear / minStake) * 100 : 0

  const totalNodesNum = totalNodes != null ? toNum(totalNodes) : 0
  const period = periodStats ? toNum(periodStats.period) : 0
  const totalGbStored = periodStats ? toNum(periodStats.totalGbStored) : 0
  const totalRewardsDistributed = periodStats ? periodStats.totalRewardsDistributed : 0n
  const activeNodes = periodStats ? toNum(periodStats.activeNodes) : 0
  const challengesIssued = periodStats ? toNum(periodStats.challengesIssued) : 0
  const challengesPassed = periodStats ? toNum(periodStats.challengesPassed) : 0
  const successRate = challengesIssued > 0 ? Math.round((challengesPassed / challengesIssued) * 100) : 0

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-slate-400">
          Vue d’ensemble du réseau de stockage décentralisé — données en direct depuis le contrat buildnet.
        </p>
      </div>

      {/* Priorité : APY en très gros, explications au hover de la bulle info */}
      <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-slate-800/80 p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-wider text-amber-400">
          Récompense actuelle
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
            {apyPercent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
          </span>
          <span className="text-2xl font-semibold text-slate-300 sm:text-3xl">APY</span>
          <div className="group relative ml-1 inline-flex">
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-500 bg-slate-700/80 text-slate-400 transition-colors hover:border-amber-500/50 hover:bg-slate-700 hover:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              aria-label="Comment est calculé l’APY ?"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
            <div className="absolute bottom-full left-1/2 z-10 mb-2 hidden w-80 -translate-x-1/2 rounded-xl border border-slate-600 bg-slate-800 p-4 text-sm shadow-xl group-hover:block group-focus-within:block">
              <p className="font-medium text-slate-200">APY indicatif</p>
              <p className="mt-1 text-slate-400">Stake min + 1 GB alloué.</p>
              <p className="mt-2 text-slate-300">
                {formatNanoMas(rewardPerGbPerYear)} / GB / an
                <span className="text-slate-500"> ({formatNanoMas(rewardPerGb)} / GB / période)</span>.
              </p>
              <p className="mt-2 text-slate-300">
                Ex. {EXAMPLE_GB} GB → jusqu’à {formatNanoMas(exampleRewardPerYear)} / an
                {apyExamplePercent > 0 && (
                  <> ({apyExamplePercent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % APY sur stake min)</>
                )}.
              </p>
              <p className="mt-2 text-slate-400">
                Allouez du stockage et gagnez des MAS en validant les défis de preuve. Le rendement dépend du taux de succès aux challenges.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Réseau — getTotalNodes + PeriodStats */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Réseau</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Nœuds enregistrés" value={totalNodesNum.toLocaleString('fr-FR')} />
          <StatCard label="Nœuds actifs" value={activeNodes.toLocaleString('fr-FR')} />
          <StatCard label="Stockage total" value={`${totalGbStored} GB`} />
          <StatCard
            label="Récompenses distribuées (période)"
            value={formatNanoMas(totalRewardsDistributed)}
            subtext={period > 0 ? `Période ${period.toLocaleString('fr-FR')}` : 'Période courante'}
          />
        </div>
      </section>

      {/* Période courante — PeriodStats */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Période courante</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Période" value={period.toLocaleString('fr-FR')} />
          <StatCard label="Challenges émis" value={challengesIssued.toLocaleString('fr-FR')} />
          <StatCard label="Challenges réussis" value={challengesPassed.toLocaleString('fr-FR')} />
          <StatCard
            label="Taux de succès"
            value={`${successRate} %`}
            subtext="Preuves de stockage validées"
          />
        </div>
      </section>

      {/* Configuration — getConfig (StorageConfig) */}
      {config && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-200">Configuration du contrat</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Récompense par GB / période"
              value={formatNanoMas(config.rewardPerGbPerPeriod)}
            />
            <StatCard
              label="Allocation min / max"
              value={`${toNum(config.minAllocatedGb)} – ${toNum(config.maxAllocatedGb)} GB`}
            />
            <StatCard label="Stake minimum" value={formatNanoMas(config.minStake)} />
            <StatCard
              label="Timeout défi"
              value={formatMs(config.challengeResponseTimeout)}
              subtext="Temps pour répondre à un challenge"
            />
            <StatCard
              label="Pénalité (échec défi)"
              value={`${toNum(config.slashPercentage)} %`}
            />
          </div>
        </section>
      )}
    </div>
  )
}

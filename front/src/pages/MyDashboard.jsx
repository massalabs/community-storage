import { useEffect, useState } from 'react'
import { useWallet } from '../context/WalletContext'
import { getNodeInfo } from '../contract/storageRegistryApi'
import { StatCard } from '../components/StatCard'

function toNum(v) {
  return typeof v === 'bigint' ? Number(v) : v
}

function formatNanoMas(nano) {
  const n = toNum(nano)
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR')} MAS`
  return `${n.toLocaleString('fr-FR')} nanoMAS`
}

export function MyDashboard() {
  const { address, connected } = useWallet()
  const [nodeInfo, setNodeInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!address) {
      setNodeInfo(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getNodeInfo(address)
      .then((info) => {
        if (!cancelled) setNodeInfo(info)
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Erreur')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [address])

  if (!connected || !address) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-200">
          <p className="font-medium">Connectez votre wallet</p>
          <p className="mt-1 text-sm text-amber-200/80">
            Connectez-vous pour voir vos récompenses, votre stockage alloué et les infos de votre nœud.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          Chargement des infos de votre nœud…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <p className="font-medium">Erreur</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!nodeInfo) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <p className="text-slate-400">
          Vue d’ensemble de votre nœud de stockage — récompenses, stockage alloué et statistiques.
        </p>
        <div className="rounded-xl border border-slate-600 bg-slate-800/50 p-6">
          <p className="font-medium text-slate-200">Vous n’êtes pas enregistré comme nœud de stockage</p>
          <p className="mt-2 text-sm text-slate-400">
            Enregistrez votre nœud pour allouer du stockage et gagner des récompenses MAS.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Adresse connectée : <span className="font-mono text-slate-400">{address}</span>
          </p>
        </div>
      </div>
    )
  }

  const allocatedGb = toNum(nodeInfo.allocatedGb)
  const pendingRewards = nodeInfo.pendingRewards
  const totalChallenges = toNum(nodeInfo.totalChallenges)
  const passedChallenges = toNum(nodeInfo.passedChallenges)
  const successRate = totalChallenges > 0 ? Math.round((passedChallenges / totalChallenges) * 100) : 100
  const registeredPeriod = toNum(nodeInfo.registeredPeriod)
  const stakedAmount = nodeInfo.stakedAmount
  const lastChallengedPeriod = toNum(nodeInfo.lastChallengedPeriod)
  const active = nodeInfo.active

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
        <p className="mt-1 text-slate-400">
          Vue d’ensemble de votre nœud — récompenses, stockage et statistiques.
        </p>
      </div>

      {/* Récompenses */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Récompenses</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Récompenses en attente"
            value={formatNanoMas(pendingRewards)}
            subtext="À réclamer (claimRewards)"
          />
          <StatCard
            label="Taux de succès aux challenges"
            value={`${successRate} %`}
            subtext={`${passedChallenges} / ${totalChallenges} réussis`}
          />
        </div>
      </section>

      {/* Stockage & nœud */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Stockage & nœud</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Stockage alloué" value={`${allocatedGb} GB`} />
          <StatCard label="Statut" value={active ? 'Actif' : 'Inactif'} />
          <StatCard label="Période d’inscription" value={registeredPeriod.toLocaleString('fr-FR')} />
          <StatCard
            label="Dernier challenge (période)"
            value={lastChallengedPeriod > 0 ? lastChallengedPeriod.toLocaleString('fr-FR') : '—'}
          />
        </div>
      </section>

      {/* Stake */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Stake</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Stake actuel" value={formatNanoMas(stakedAmount)} />
        </div>
      </section>

      <div className="rounded-lg border border-slate-600 bg-slate-800/30 px-4 py-2 text-sm text-slate-500">
        Adresse du nœud : <span className="font-mono text-slate-400">{address}</span>
      </div>
    </div>
  )
}

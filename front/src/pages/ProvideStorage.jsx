import { useCallback, useEffect, useState } from 'react'
import { Args } from '@massalabs/massa-web3'
import { useWallet } from '../context/WalletContext'
import {
  getContractAddress,
  getConfig,
  getNodeInfo,
  isSandboxMode,
} from '../contract/storageRegistryApi'
import { StatCard } from '../components/StatCard'

function toNum(v) {
  return typeof v === 'bigint' ? Number(v) : v
}

function formatNanoMas(nano) {
  const n = toNum(nano)
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR')} MAS`
  return `${n.toLocaleString('fr-FR')} nanoMAS`
}

const PAGE_TITLE = 'Provide Storage'

export function ProvideStorage() {
  const { address, connected, account } = useWallet()
  const [nodeInfo, setNodeInfo] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState(null)

  const fetchNodeInfo = useCallback(async () => {
    if (!address) return
    const info = await getNodeInfo(address).catch(() => null)
    setNodeInfo(info)
  }, [address])

  const sandbox = isSandboxMode()
  const pendingNano = nodeInfo ? (typeof nodeInfo.pendingRewards === 'bigint' ? nodeInfo.pendingRewards : BigInt(nodeInfo.pendingRewards ?? 0)) : 0n
  const hasPendingRewards = pendingNano > 0n

  const handleClaim = useCallback(async () => {
    if (sandbox || !account || !address || !hasPendingRewards) return
    if (typeof account.callSC !== 'function') {
      setClaimError('Ce wallet ne supporte pas l\'appel au contrat.')
      return
    }
    setClaiming(true)
    setClaimError(null)
    try {
      const contractAddress = getContractAddress()
      const emptyArgs = new Args().serialize()
      await account.callSC({
        func: 'claimRewards',
        target: contractAddress,
        parameter: emptyArgs,
      })
      await fetchNodeInfo()
    } catch (e) {
      setClaimError(e?.message ?? 'Erreur lors du claim.')
    } finally {
      setClaiming(false)
    }
  }, [sandbox, account, address, hasPendingRewards, fetchNodeInfo])

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
    Promise.all([getNodeInfo(address), getConfig()])
      .then(([info, cfg]) => {
        if (!cancelled) {
          setNodeInfo(info)
          setConfig(cfg)
        }
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
      <div className="space-y-8">
        <h1 className="text-xl font-semibold tracking-tight text-white">{PAGE_TITLE}</h1>
        <div className="glass-panel geo-frame border border-line p-6">
          <p className="font-medium">Connectez votre wallet</p>
          <p className="mt-1 text-sm text-amber-200/80">
            Connectez-vous pour voir l’occupation de votre stockage, vos récompenses et les infos de votre nœud.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="border-l-2 border-accent pl-6">
          <h1 className="text-xl font-semibold tracking-tight text-white">{PAGE_TITLE}</h1>
        </div>
        <div className="flex items-center gap-3 text-zinc-500">
          <span className="h-4 w-4 border-2 border-accent border-t-transparent animate-spin" />
          <span className="text-xs uppercase tracking-wide">Chargement…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="border-l-2 border-accent pl-6">
          <h1 className="text-xl font-semibold text-white">{PAGE_TITLE}</h1>
        </div>
        <div className="glass-panel border border-line border-l-2 border-l-red-500/60 p-4">
          <p className="text-xs font-medium uppercase text-red-400/90">Erreur</p>
          <p className="mt-1 text-xs text-zinc-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!nodeInfo) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">{PAGE_TITLE}</h1>
        <p className="text-zinc-500">
          Vue d’ensemble de votre nœud de stockage — occupation, récompenses et statistiques.
        </p>
        <div className="glass-panel geo-frame border border-line p-6">
          <p className="font-medium text-white">Vous n’êtes pas enregistré comme nœud de stockage</p>
          <p className="mt-2 text-sm text-zinc-500">
            Enregistrez votre nœud pour allouer du stockage et gagner des récompenses MAS.
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Adresse connectée : <span className="font-mono text-zinc-500">{address}</span>
          </p>
        </div>
      </div>
    )
  }

  const allocatedGb = toNum(nodeInfo.allocatedGb)
  const usedGb = nodeInfo.usedGb != null ? toNum(nodeInfo.usedGb) : null
  const pendingRewards = nodeInfo.pendingRewards
  const totalChallenges = toNum(nodeInfo.totalChallenges)
  const passedChallenges = toNum(nodeInfo.passedChallenges)
  const successRate = totalChallenges > 0 ? Math.round((passedChallenges / totalChallenges) * 100) : 100
  const registeredPeriod = toNum(nodeInfo.registeredPeriod)
  const stakedAmount = nodeInfo.stakedAmount
  const lastChallengedPeriod = toNum(nodeInfo.lastChallengedPeriod)
  const active = nodeInfo.active

  const occupationLabel = usedGb != null
    ? `${usedGb} GB / ${allocatedGb} GB`
    : `— / ${allocatedGb} GB`

  const rewardPerGb = config?.rewardPerGbPerPeriod ?? 0n
  const estimatePerPeriodNano = BigInt(allocatedGb) * (typeof rewardPerGb === 'bigint' ? rewardPerGb : BigInt(rewardPerGb))


  return (
    <div className="space-y-12">
      <div className="border-l-2 border-accent pl-6">
        <h1 className="text-xl font-semibold tracking-tight text-white">{PAGE_TITLE}</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
          Vue d’ensemble de votre nœud — occupation, récompenses et statistiques.
        </p>
      </div>

      {/* Occupation du stockage */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">Occupation du stockage</h2>
        <div className="glass-panel geo-frame border border-line p-6">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-bold text-white">{occupationLabel}</span>
            {usedGb != null && allocatedGb > 0 && (
              <span className="text-zinc-500">
                ({Math.round((usedGb / allocatedGb) * 100)} % utilisés)
              </span>
            )}
          </div>
          {usedGb == null && (
            <p className="mt-2 text-sm text-zinc-500">
              L’occupation utilisée sera affichée lorsque votre nœud rapportera ses métriques.
            </p>
          )}
        </div>
      </section>

      {/* Récompenses */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">Récompenses</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Estimate rewards"
            value={config ? formatNanoMas(estimatePerPeriodNano) : '…'}
            subtext="Par période (allocated GB × reward/GB)"
          />
          <div className="glass-panel geo-frame border border-line p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rewards available</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-accent">{formatNanoMas(pendingRewards)}</p>
            {hasPendingRewards && !sandbox && account && (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                className="mt-3 w-full border border-line py-2 text-xs font-medium uppercase tracking-wide text-white hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {claiming ? 'Claim en cours…' : 'Claim'}
              </button>
            )}
            {hasPendingRewards && sandbox && (
              <p className="mt-2 text-xs text-zinc-500">Claim désactivé en mode bac à sable.</p>
            )}
            {claimError && (
              <p className="mt-2 text-sm text-red-400">{claimError}</p>
            )}
          </div>
          <StatCard
            label="Taux de succès aux challenges"
            value={`${successRate} %`}
            subtext={`${passedChallenges} / ${totalChallenges} réussis`}
          />
        </div>
      </section>

      {/* Stockage & nœud */}
      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">Stockage & nœud</h2>
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
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">Stake</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Stake actuel" value={formatNanoMas(stakedAmount)} />
        </div>
      </section>

      <div className="glass-panel border border-line px-4 py-2 text-sm text-zinc-500">
        Adresse du nœud : <span className="font-mono text-zinc-500">{address}</span>
      </div>
    </div>
  )
}

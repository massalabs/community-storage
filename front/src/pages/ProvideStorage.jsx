import { useCallback, useEffect, useState } from 'react'
import { Args, ArrayTypes } from '@massalabs/massa-web3'
import { useWriteSmartContract } from '@massalabs/react-ui-kit'
import { useWallet } from '../context/WalletContext'
import {
  getContractAddress,
  getConfig,
  getNodeInfo,
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
  const [serverEndpoint, setServerEndpoint] = useState('')
  const [p2pAddrs, setP2pAddrs] = useState('')
  const [metadata, setMetadata] = useState(null)
  const [fetchingMetadata, setFetchingMetadata] = useState(false)

  // Use buildnet (false) since this is a buildnet app
  const {
    callSmartContract: callClaimRewards,
    isOpPending: isClaimPending,
    isPending: isClaimLoading,
  } = useWriteSmartContract(account, false)

  const {
    callSmartContract: callRegisterNode,
    isOpPending: isRegisterPending,
    isPending: isRegisterLoading,
  } = useWriteSmartContract(account, false)

  const fetchNodeInfo = useCallback(async () => {
    if (!address) return
    const info = await getNodeInfo(address).catch(() => null)
    setNodeInfo(info)
  }, [address])

  const pendingNano = nodeInfo ? (typeof nodeInfo.pendingRewards === 'bigint' ? nodeInfo.pendingRewards : BigInt(nodeInfo.pendingRewards ?? 0)) : 0n
  const hasPendingRewards = pendingNano > 0n

  const handleClaim = useCallback(async () => {
    if (!account || !address || !hasPendingRewards) return
    try {
      const contractAddress = getContractAddress()
      const emptyArgs = new Args().serialize()
      await callClaimRewards(
        'claimRewards',
        contractAddress,
        emptyArgs,
        {
          pending: 'Réclamation des récompenses en cours...',
          success: 'Récompenses réclamées avec succès!',
          error: 'Erreur lors de la réclamation des récompenses',
        }
      )
      await fetchNodeInfo()
    } catch (e) {
      // Error is handled by the hook via toast
    }
  }, [account, address, hasPendingRewards, fetchNodeInfo, callClaimRewards])

  const fetchServerMetadata = useCallback(async (endpoint) => {
    if (!endpoint || !endpoint.trim()) {
      setMetadata(null)
      return
    }
    setFetchingMetadata(true)
    try {
      // Normalize endpoint URL (add http:// if missing, remove trailing slash)
      let normalizedEndpoint = endpoint.trim()
      if (!normalizedEndpoint.startsWith('http://') && !normalizedEndpoint.startsWith('https://')) {
        normalizedEndpoint = `http://${normalizedEndpoint}`
      }
      normalizedEndpoint = normalizedEndpoint.replace(/\/$/, '')
      
      const configUrl = `${normalizedEndpoint}/config`
      const configRes = await fetch(configUrl)
      if (!configRes.ok) {
        throw new Error(`Failed to fetch config: ${configRes.status} ${configRes.statusText}`)
      }
      const config = await configRes.json()
      if (!config.storage_limit_gb || config.storage_limit_gb <= 0) {
        throw new Error('Server reported invalid storage_limit_gb')
      }
      
      // Extract P2P addresses from config
      const p2pAddrsFromConfig = config.p2p_listen_addr 
        ? [config.p2p_listen_addr].filter(Boolean)
        : []
      
      // Pre-populate P2P addresses field if available and empty
      if (p2pAddrsFromConfig.length > 0 && !p2pAddrs.trim()) {
        setP2pAddrs(p2pAddrsFromConfig.join(', '))
      }
      
      setMetadata({
        endpoint: normalizedEndpoint,
        allocatedGb: BigInt(config.storage_limit_gb),
        p2pAddrs: p2pAddrsFromConfig,
      })
    } catch (e) {
      setMetadata(null)
      // Error will be shown via toast if needed
    } finally {
      setFetchingMetadata(false)
    }
  }, [])

  const handleRegister = useCallback(async () => {
    if (!account || !address || !metadata) return
    try {
      const contractAddress = getContractAddress()
      
      // Parse P2P addresses: use from config if available, otherwise from input field
      let p2pArray = []
      if (metadata.p2pAddrs && metadata.p2pAddrs.length > 0) {
        // Use P2P addresses from config endpoint
        p2pArray = metadata.p2pAddrs
      } else if (p2pAddrs.trim()) {
        // Fallback to manual input (comma-separated)
        p2pArray = p2pAddrs
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0)
      }
      
      // Register the storage node with allocated GB and metadata (endpoint + P2P addresses) in a single call
      const registerArgs = new Args()
        .addU64(metadata.allocatedGb)
        .addString(metadata.endpoint)
        .addArray(p2pArray, ArrayTypes.STRING)
        .serialize()
      await callRegisterNode(
        'registerStorageNode',
        contractAddress,
        registerArgs,
        {
          pending: 'Enregistrement du nœud en cours...',
          success: 'Nœud enregistré avec succès!',
          error: 'Erreur lors de l\'enregistrement du nœud',
        }
      )
      
      // Refresh node info
      await fetchNodeInfo()
      setServerEndpoint('')
      setP2pAddrs('')
      setMetadata(null)
    } catch (e) {
      // Error is handled by the hook via toast
    }
  }, [account, address, metadata, p2pAddrs, fetchNodeInfo, callRegisterNode])

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
        <div className="card-panel p-6 space-y-6">
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
        <div className="card-panel border-l-red-500/60 p-4">
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
        <div className="card-panel p-6 space-y-6">
            <p className="font-medium text-white">Vous n'êtes pas enregistré comme nœud de stockage</p>
            <p className="mt-2 text-sm text-zinc-500">
              Enregistrez votre nœud pour allouer du stockage et gagner des récompenses MAS.
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Adresse connectée : <span className="font-mono text-zinc-500">{address}</span>
            </p>
          </div>

          {/* Registration Form */}
          <div className="border-t border-line pt-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Enregistrer votre nœud
            </h2>
            
            <div className="space-y-4">
              <div>
                <label htmlFor="server-endpoint" className="block text-xs font-medium text-zinc-400 mb-2">
                  Adresse du serveur (IP ou URL)
                </label>
                <div className="flex gap-2">
                  <input
                    id="server-endpoint"
                    type="text"
                    value={serverEndpoint}
                    onChange={(e) => {
                      setServerEndpoint(e.target.value)
                      setRegisterError(null)
                    }}
                    onBlur={() => {
                      if (serverEndpoint.trim()) {
                        fetchServerMetadata(serverEndpoint)
                      }
                    }}
                    placeholder="http://127.0.0.1:4343 ou 192.168.1.100:4343"
                    className="flex-1 bg-zinc-900 border border-line px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-accent"
                    disabled={isRegisterPending || fetchingMetadata}
                  />
                  {serverEndpoint && (
                    <button
                      type="button"
                      onClick={() => fetchServerMetadata(serverEndpoint)}
                      disabled={isRegisterPending || fetchingMetadata || !serverEndpoint.trim()}
                      className="px-4 py-2 border border-line text-xs font-medium uppercase tracking-wide text-white hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {fetchingMetadata ? '…' : 'Récupérer'}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Le serveur doit exposer un endpoint <code className="text-zinc-400">/config</code> pour récupérer les métadonnées.
                </p>
              </div>

              {metadata && (
                <div className="bg-zinc-800/50 border border-line p-4 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Métadonnées récupérées
                  </p>
                  <div className="space-y-1 text-sm">
                    <p className="text-zinc-300">
                      <span className="text-zinc-500">Endpoint:</span> <span className="font-mono">{metadata.endpoint}</span>
                    </p>
                    <p className="text-zinc-300">
                      <span className="text-zinc-500">Stockage alloué:</span> {toNum(metadata.allocatedGb)} GB
                    </p>
                    {metadata.p2pAddrs && metadata.p2pAddrs.length > 0 && (
                      <p className="text-zinc-300">
                        <span className="text-zinc-500">P2P:</span> <span className="font-mono text-xs">{metadata.p2pAddrs.join(', ')}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="p2p-addrs" className="block text-xs font-medium text-zinc-400 mb-2">
                  Adresses P2P (optionnel, séparées par des virgules)
                </label>
                <input
                  id="p2p-addrs"
                  type="text"
                  value={p2pAddrs}
                  onChange={(e) => setP2pAddrs(e.target.value)}
                  placeholder="/ip4/127.0.0.1/tcp/4001/p2p/..."
                  className="w-full bg-zinc-900 border border-line px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-accent"
                  disabled={isRegisterPending || fetchingMetadata}
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Multiaddrs libp2p pour la connexion P2P (optionnel).
                </p>
              </div>


              <button
                type="button"
                onClick={handleRegister}
                disabled={isRegisterPending || fetchingMetadata || !metadata || !account}
                className="w-full border border-accent bg-accent/10 py-3 text-sm font-medium uppercase tracking-wide text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRegisterLoading ? 'Enregistrement en cours…' : 'Enregistrer le nœud'}
              </button>
            </div>
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
        <div className="card-panel p-6 space-y-6">
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
          <div className="card-panel p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rewards available</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-accent">{formatNanoMas(pendingRewards)}</p>
            {hasPendingRewards && account && (
              <button
                type="button"
                onClick={handleClaim}
                disabled={isClaimPending}
                className="mt-3 w-full border border-line py-2 text-xs font-medium uppercase tracking-wide text-white hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {isClaimLoading ? 'Claim en cours…' : 'Claim'}
              </button>
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

      <div className="card-panel px-4 py-2 text-sm text-zinc-500">
        Adresse du nœud : <span className="font-mono text-zinc-500">{address}</span>
      </div>
    </div>
  )
}

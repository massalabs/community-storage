import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import {
  getConfig,
  getStorageProviders,
  getContractAddress,
  getBookedUploaderGb,
  getUploaderPricePerGb,
  registerAsUploaderWithTransfer,
} from '../contract/storageRegistryApi'
import { addStoredFiles } from '../lib/myFilesStorage'
import { checkProviderUp } from '../lib/providerHealth'
import { uploadFileToProviders } from '../lib/uploadToProvider'
import { getBlocklistSet } from '../lib/blocklistStorage'

function toNum(v) {
  return typeof v === 'bigint' ? Number(v) : v
}

function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

function truncateAddress(addr) {
  if (!addr || addr.length < 16) return addr
  return `${addr.slice(0, 8)}…${addr.slice(-8)}`
}

function CopyIcon({ className = '', ...props }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

const DURATION_OPTIONS = [
  { value: 1, label: '1 mois' },
  { value: 3, label: '3 mois' },
  { value: 6, label: '6 mois' },
  { value: 12, label: '12 mois' },
]

export function StoreFiles() {
  const navigate = useNavigate()
  const { connected, account, address } = useWallet()
  const [config, setConfig] = useState(null)
  const [providers, setProviders] = useState([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [files, setFiles] = useState([]) // File[]
  const [replicationCount, setReplicationCount] = useState(1)
  const [durationMonths, setDurationMonths] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [storing, setStoring] = useState(false)
  const [storeError, setStoreError] = useState(null)
  const [providersError, setProvidersError] = useState(null)
  const [providerStatus, setProviderStatus] = useState({})
  const [copiedAddress, setCopiedAddress] = useState(null)
  /** Coût d'enregistrement uploader si nécessaire (needToBook en GB, bookingNano en nanoMAS) */
  const [uploaderBooking, setUploaderBooking] = useState({ needToBook: 0n, bookingNano: 0n })

  useEffect(() => {
    let cancelled = false
    getConfig()
      .then((c) => { if (!cancelled) setConfig(c) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadingProviders(true)
    setProvidersError(null)
    getStorageProviders()
      .then((list) => { if (!cancelled) setProviders(list || []) })
      .catch((e) => {
        if (!cancelled) {
          setProviders([])
          setProvidersError(e?.message || 'Impossible de charger les providers')
        }
      })
      .finally(() => { if (!cancelled) setLoadingProviders(false) })
    return () => { cancelled = true }
  }, [])

  // Quand la modal de confirmation s'ouvre : calcul du coût d'enregistrement uploader (invisible pour l'utilisateur, inclus dans le total)
  useEffect(() => {
    if (!confirmOpen || !address || !files.length) {
      setUploaderBooking({ needToBook: 0n, bookingNano: 0n })
      return
    }
    let cancelled = false
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0)
    const needBookingGb = BigInt(Math.max(1, Math.ceil(totalBytes / 1e9)))
    Promise.all([getBookedUploaderGb(address), getUploaderPricePerGb()])
      .then(([bookedGb, pricePerGb]) => {
        if (cancelled) return
        const needToBook = needBookingGb > bookedGb ? needBookingGb - bookedGb : 0n
        const bookingNano = needToBook * pricePerGb
        setUploaderBooking({ needToBook, bookingNano })
      })
      .catch(() => {
        if (!cancelled) setUploaderBooking({ needToBook: 0n, bookingNano: 0n })
      })
    return () => { cancelled = true }
  }, [confirmOpen, address, files])

  // Health check des providers (endpoint HTTP) pour afficher Up/Down
  useEffect(() => {
    if (!providers.length) {
      setProviderStatus({})
      return
    }
    const withEndpoint = providers.filter((p) => p.endpoint)
    if (withEndpoint.length === 0) {
      setProviderStatus({})
      return
    }
    let cancelled = false
    const initial = {}
    withEndpoint.forEach((p) => { initial[p.address] = 'checking' })
    setProviderStatus(initial)
    withEndpoint.forEach((p) => {
      checkProviderUp(p.endpoint).then((status) => {
        if (!cancelled) setProviderStatus((prev) => ({ ...prev, [p.address]: status }))
      })
    })
    return () => { cancelled = true }
  }, [providers])

  const blocklistSet = useMemo(() => getBlocklistSet(address), [address])

  const eligibleProviders = useMemo(() => {
    return providers.filter(
      (p) =>
        !blocklistSet.has((p.address || '').toLowerCase()) &&
        p.endpoint &&
        Number(p.availableGb ?? p.allocatedGb ?? 0) > 0
    )
  }, [providers, blocklistSet])

  const autoSelectedProviders = useMemo(() => {
    const sorted = [...eligibleProviders].sort(
      (a, b) => Number((b.availableGb ?? 0n) - (a.availableGb ?? 0n))
    )
    return sorted.slice(0, replicationCount).map((p) => p.address)
  }, [eligibleProviders, replicationCount])

  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)
  const totalGb = totalBytes / 1e9
  // Tarif fixe pour l’estimation : 1 MAS / mois pour ~2 Mo (500e9 nanoMAS/GB/mois)
  const REWARD_PER_GB_PER_MONTH = 500000000000
  const effectiveGb = files.length > 0 && totalGb > 0 ? totalGb : (files.length > 0 ? 2 / 1024 : 0)
  const priceNano = effectiveGb > 0
    ? Math.ceil(effectiveGb * replicationCount * durationMonths * REWARD_PER_GB_PER_MONTH)
    : 0
  const priceMas = priceNano / 1e9

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const list = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []
    if (list.length) setFiles((prev) => [...prev, ...list])
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleFileInput = useCallback((e) => {
    const list = e.target?.files ? Array.from(e.target.files) : []
    if (list.length) setFiles((prev) => [...prev, ...list])
    e.target.value = ''
  }, [])

  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearAllFiles = useCallback(() => {
    setFiles([])
  }, [])

  const handleConfirmStore = useCallback(async () => {
    if (!files.length || autoSelectedProviders.length < replicationCount) return
    if (!connected || !account || typeof account.transfer !== 'function') {
      setStoreError('Connectez votre wallet pour payer les providers en MAS (buildnet).')
      return
    }
    setStoreError(null)
    const storageNano = BigInt(Math.ceil(priceNano))
    const totalToPay = uploaderBooking.bookingNano + storageNano
    if (totalToPay > 0n && account && typeof account.balance === 'function') {
      try {
        const balance = await account.balance(true)
        if (balance != null && balance < totalToPay) {
          const needMas = (Number(totalToPay) / 1e9).toFixed(4)
          setStoreError(`Solde insuffisant. Il vous faut au moins ${needMas} MAS (buildnet).`)
          return
        }
      } catch (e) {
        setStoreError(e?.message ?? 'Impossible de vérifier le solde.')
        return
      }
    }
    setStoring(true)
    const now = new Date()
    const expires = new Date(now)
    expires.setMonth(expires.getMonth() + durationMonths)
    const providerEndpoints = autoSelectedProviders
      .map((addr) => providers.find((p) => p.address === addr)?.endpoint)
      .filter(Boolean)

    // 0. Enregistrement uploader si nécessaire (invisible : un seul total affiché)
    if (uploaderBooking.needToBook > 0n) {
      try {
        if (typeof account.callSC !== 'function') {
          setStoreError('Ce wallet ne supporte pas l\'enregistrement uploader (appel contrat avec paiement).')
          setStoring(false)
          return
        }
        await registerAsUploaderWithTransfer(account, uploaderBooking.needToBook)
      } catch (e) {
        setStoreError(e?.message ?? 'Enregistrement uploader échoué. Vérifiez votre solde et réessayez.')
        setStoring(false)
        return
      }
    }

    // Le wallet (Bearby/Massa Station) retourne SignedData { signature, publicKey } ; pas de publicKey sur le compte.
    const signer =
      typeof account.sign === 'function' && address
        ? {
            address,
            sign: (data) => Promise.resolve(account.sign(data)),
          }
        : null

    const entries = files.map((f) => ({
      id: crypto.randomUUID?.() ?? `f-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      size: f.size,
      replicationCount,
      durationMonths,
      providers: [...autoSelectedProviders],
      providerEndpoints: providerEndpoints.length ? providerEndpoints : undefined,
      uploadedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      uploaderAddress: address,
    }))

    // 1. D'abord envoyer le fichier aux providers ; on ne prélève les MAS qu'après succès
    let uploadOk = false
    if (providerEndpoints.length > 0) {
      const uploadResults = []
      for (let i = 0; i < files.length; i++) {
        const { succeeded, failed } = await uploadFileToProviders(
          providerEndpoints,
          files[i],
          entries[i].id,
          signer
        )
        uploadResults.push({ succeeded, failed })
        entries[i].uploadedTo = succeeded.length ? succeeded : undefined
      }
      const allFailed = uploadResults.every((r) => r.succeeded.length === 0)
      if (allFailed) {
        setStoreError(
          'Aucun provider n\'a accepté le fichier. Aucun prélèvement. Vérifiez les URLs et que le serveur est joignable.'
        )
        setStoring(false)
        return
      }
      uploadOk = true
      const anyFailed = uploadResults.some((r) => r.failed.length > 0)
      if (anyFailed) {
        setStoreError(
          'Certains providers n\'ont pas répondu ; les fichiers ont été envoyés où c\'était possible. Paiement pour les providers ayant répondu.'
        )
      }
    }

    // 2. Paiement stockage au smart contract (l'enregistrement uploader a déjà été fait en étape 0)
    if (uploadOk && storageNano > 0n && autoSelectedProviders.length > 0) {
      try {
        const contractAddress = getContractAddress()
        await account.transfer(contractAddress, storageNano)
      } catch (e) {
        setStoreError(e?.message ?? 'Fichier(s) envoyé(s) mais paiement MAS refusé ou échoué. Vérifiez votre solde buildnet.')
        setStoring(false)
        return
      }
    }

    if (address) addStoredFiles(address, entries)
    setStoring(false)
    setConfirmOpen(false)
    setStoreError(null)
    clearAllFiles()
    navigate('/my-files')
  }, [files, autoSelectedProviders, replicationCount, durationMonths, providers, priceNano, uploaderBooking, connected, account, address, clearAllFiles, navigate])

  const replicationOptions = Array.from({ length: 10 }, (_, i) => i + 1)

  const hasFiles = files.length > 0
  const canStore =
    hasFiles &&
    !storing &&
    autoSelectedProviders.length >= replicationCount &&
    connected

  return (
    <div className="space-y-10">
      <div>
        <div className="border-l-2 border-accent pl-6">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-white sm:text-3xl">Upload</h1>
          <p className="mt-2 font-mono text-sm uppercase tracking-wide text-zinc-500">
            Déposez vos fichiers ; les providers sont choisis automatiquement (hors blocklist).
          </p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Zone drag & drop + sélection fichier en premier plan */}
        <section className="space-y-6">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative min-h-[220px] border-2 border-dashed flex flex-col items-center justify-center gap-4 px-6 py-12 text-center transition ${
              isDragging ? 'border-accent bg-accent-dim' : 'border-line glass-panel hover:border-line-strong'
            }`}
          >
            <input
              type="file"
              id="store-files-input"
              className="hidden"
              multiple
              onChange={handleFileInput}
            />
            <label htmlFor="store-files-input" className="cursor-pointer flex flex-col items-center gap-4 w-full">
              <span className="font-mono text-4xl text-zinc-600" aria-hidden>↑</span>
              <p className="font-mono text-lg uppercase tracking-wide text-zinc-400">
                Glissez-déposez vos fichiers ici
              </p>
              <p className="font-mono text-sm text-zinc-500">
                ou <span className="text-accent underline underline-offset-2">parcourir</span> pour en choisir
              </p>
            </label>
          </div>

          {hasFiles && (
            <div className="card-panel p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Fichiers ({files.length})</h3>
                <button type="button" onClick={clearAllFiles} className="text-sm text-zinc-500 hover:text-red-400">Tout retirer</button>
              </div>
              <ul className="scrollbar-app max-h-32 space-y-2 overflow-y-auto">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 border border-line bg-white/5 px-3 py-2 text-sm">
                    <span className="truncate text-zinc-200" title={f.name}>{f.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-zinc-500">{formatBytes(f.size)}</span>
                      <button type="button" onClick={() => removeFile(i)} className="rounded p-1 text-zinc-500 hover:bg-surface hover:text-red-400">×</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div>
                <label className="block text-sm font-medium text-zinc-500 mb-2">
                  Nombre de réplications
                </label>
                <select
                  value={replicationCount}
                  onChange={(e) => setReplicationCount(Number(e.target.value))}
                  className="w-full border border-line bg-surface px-4 py-2 text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent [color-scheme:dark]"
                >
                  {replicationOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500">
                  Les providers sont choisis automatiquement (espace dispo + endpoint, hors blocklist). l’assigner à une réplication.
                </p>
              </div>

              <div className="card-panel p-4">
                <p className="text-sm text-zinc-500">Prix estimé</p>
                <p className="text-2xl font-bold text-accent">
                  {priceMas.toFixed(4)} MAS
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {formatBytes(totalBytes || 0)} × {replicationCount} répl. × {durationMonths} mois (1 MAS / mois pour ~2 Mo)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-500 mb-2">Durée (mensuelle)</label>
                <select value={durationMonths} onChange={(e) => setDurationMonths(Number(e.target.value))} className="w-full border border-line bg-surface px-4 py-2 text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent [color-scheme:dark]">
                  {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {hasFiles && autoSelectedProviders.length < replicationCount && (
                <p className="text-sm text-amber-400/90">
                  Pas assez de providers éligibles ({autoSelectedProviders.length} / {replicationCount}). Réduisez la blocklist ou le nombre de réplications.
                </p>
              )}
              {!connected && (
                <p className="text-sm text-amber-400/90">Connectez votre wallet (buildnet) pour payer en MAS et storer.</p>
              )}
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canStore} className="w-full border border-line bg-surface text-accent hover:border-accent py-3 text-sm font-semibold text-white hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed">Storer</button>
            </div>
          )}
        </section>

        {/* Providers auto + blocklist + liste */}
        <section className="space-y-5">
          {hasFiles && (
            <div className="card-panel p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Providers choisis automatiquement</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Sélection parmi les providers avec espace dispo et endpoint (hors blocklist). l’assigner à une réplication. Cliquez à nouveau ou sur × pour retirer.
              </p>
              {autoSelectedProviders.length >= replicationCount ? (
                <ul className="space-y-1.5 font-mono text-sm text-zinc-300">
                  {autoSelectedProviders.map((addr, i) => (
                    <li key={addr} className="flex items-center gap-2">
                      <span className="text-zinc-500">{i + 1}.</span>
                      <span title={addr}>{truncateAddress(addr)}</span>
                      {providerStatus[addr] === 'up' && <span className="text-xs text-emerald-500">Up</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-amber-400/90">
                  Pas assez de providers éligibles ({autoSelectedProviders.length} / {replicationCount}). Réduisez la blocklist ou le nombre de réplications.
                </p>
              )}
            </div>
          )}

          <div>
            <h2 className="mb-3 text-lg font-semibold text-zinc-200">Tous les providers</h2>
            {loadingProviders ? (
              <div className="flex items-center gap-3 text-zinc-500">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                Chargement des providers…
              </div>
            ) : providersError ? (
              <div className="card-panel border-l-red-500/60 p-6 text-red-400/90">
                <p className="font-medium">Erreur chargement providers</p>
                <p className="mt-1 text-sm text-zinc-400">{providersError}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  Vérifiez que le contrat est déployé sur le buildnet et que VITE_STORAGE_REGISTRY_ADDRESS pointe vers la bonne adresse.
                </p>
              </div>
            ) : providers.length === 0 ? (
              <div className="card-panel p-6 text-zinc-500">
                <p>Aucun provider enregistré sur le contrat (buildnet).</p>
                <p className="mt-1 text-sm text-zinc-500">
                  Enregistrez des nœuds de stockage via le contrat pour qu'ils apparaissent ici.
                </p>
              </div>
            ) : (
              <div className="scrollbar-app grid gap-3 sm:grid-cols-2 max-h-[420px] overflow-y-auto pr-1">
                {providers.map((p) => {
                  const blocked = blocklistSet.has((p.address || '').toLowerCase())
                  return (
                    <div
                      key={p.address}
                      className={`card-panel p-4 text-left ${blocked ? 'opacity-60 bg-red-500/5 border-red-500/20' : ''}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono text-sm font-medium text-zinc-200 truncate min-w-0" title={p.address}>
                          {truncateAddress(p.address)}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(p.address)
                            setCopiedAddress(p.address)
                            setTimeout(() => setCopiedAddress(null), 2000)
                          }}
                          className="shrink-0 p-1.5 text-zinc-500 hover:text-accent transition-colors rounded"
                          title="Copier l'adresse"
                          aria-label="Copier l'adresse"
                        >
                          <CopyIcon className="w-4 h-4" />
                        </button>
                        {copiedAddress === p.address && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
                            Copié <span aria-hidden>✓</span>
                          </span>
                        )}
                        {blocked && (
                          <span className="shrink-0 rounded border border-red-400/50 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400/90">
                            Exclu
                          </span>
                        )}
                        {!blocked && p.endpoint && (
                          <>
                            {providerStatus[p.address] === 'checking' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-500" />
                                Vérif…
                              </span>
                            ) : providerStatus[p.address] === 'up' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-500" title="Endpoint joignable">
                                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                                Up
                              </span>
                            ) : providerStatus[p.address] === 'down' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-red-400/90" title="Endpoint injoignable ou timeout">
                                <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                                Down
                              </span>
                            ) : null}
                          </>
                        )}
                        {!blocked && !p.endpoint && <span className="text-xs text-zinc-600">—</span>}
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-zinc-500">
                        <span>Alloué {toNum(p.allocatedGb)} GB</span>
                        <span className="text-accent font-medium">Dispo {toNum(p.availableGb)} GB</span>
                      </div>
                      {(p.endpoint || (p.p2pAddrs && p.p2pAddrs.length > 0)) && (
                        <div className="mt-2 border-t border-line/60 pt-2 text-xs text-zinc-500">
                          {p.endpoint && (
                            <p className="truncate font-mono" title={p.endpoint}>HTTP: {p.endpoint}</p>
                          )}
                          {p.p2pAddrs && p.p2pAddrs.length > 0 && (
                            <p className="mt-0.5 truncate font-mono" title={p.p2pAddrs[0]}>P2P: {p.p2pAddrs[0]}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Modal confirmation */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="card-panel w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title" className="text-lg font-semibold text-white">Confirmer le stockage</h2>
            {storeError && (
              <div className="mt-4 border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-400/90">
                {storeError}
              </div>
            )}
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-zinc-300"><strong>Fichiers :</strong> {files.length}</p>
              <ul className="scrollbar-app max-h-24 overflow-y-auto border border-line bg-white/5 p-2 text-zinc-500">
                {files.map((f, i) => (
                  <li key={i} className="truncate">{f.name} — {formatBytes(f.size)}</li>
                ))}
              </ul>
              <p className="text-zinc-300"><strong>Réplications :</strong> {replicationCount}</p>
              <p className="text-zinc-300"><strong>Durée :</strong> {durationMonths} mois</p>
              <p className="text-zinc-300"><strong>Providers :</strong></p>
              <ul className="text-zinc-500 font-mono text-xs">
                {autoSelectedProviders.map((addr, i) => (
                  <li key={i}>{i + 1}. {truncateAddress(addr)}</li>
                ))}
              </ul>
              <p className="border-t border-line pt-3 text-accent font-semibold">
                Total : {((Number(uploaderBooking.bookingNano) + priceNano) / 1e9).toFixed(4)} MAS
              </p>
              {(uploaderBooking.bookingNano > 0n || priceNano > 0) && (
                <p className="text-xs text-zinc-500">
                  {uploaderBooking.bookingNano > 0n ? 'Inclut l\'enregistrement uploader (réservation capacité). ' : ''}
                  Envoyé au smart contract (buildnet) ; les fichiers sont signés et uploadés vers les providers.
                </p>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 border border-line py-2 text-sm font-medium text-zinc-300 hover:bg-white/10">Annuler</button>
              <button type="button" onClick={handleConfirmStore} disabled={storing} className="flex-1 border border-line bg-surface text-accent hover:border-accent py-2 text-sm font-semibold text-white hover:border-accent disabled:opacity-50">{storing ? 'En cours…' : 'Valider'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

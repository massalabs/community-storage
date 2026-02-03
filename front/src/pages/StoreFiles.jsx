import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getConfig, getStorageProviders, isSandboxMode } from '../contract/storageRegistryApi'
import { addStoredFiles } from '../lib/myFilesStorage'
import { uploadFileToProviders } from '../lib/uploadToProvider'

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

const DURATION_OPTIONS = [
  { value: 1, label: '1 mois' },
  { value: 3, label: '3 mois' },
  { value: 6, label: '6 mois' },
  { value: 12, label: '12 mois' },
]

export function StoreFiles() {
  const navigate = useNavigate()
  const [config, setConfig] = useState(null)
  const [providers, setProviders] = useState([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [files, setFiles] = useState([]) // File[]
  const [replicationCount, setReplicationCount] = useState(1)
  const [durationMonths, setDurationMonths] = useState(1)
  const [selectedProviders, setSelectedProviders] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [storing, setStoring] = useState(false)
  const [storeError, setStoreError] = useState(null)
  const [providersError, setProvidersError] = useState(null)

  // Quand on baisse le nombre de réplications, on garde seulement les N premiers sélectionnés
  const setReplicationCountAndTrim = useCallback((n) => {
    setReplicationCount(n)
    setSelectedProviders((prev) => prev.slice(0, n))
  }, [])

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

  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)
  const totalGb = totalBytes / 1e9
  const priceNano = files.length && config
    ? Math.ceil(totalGb * replicationCount * durationMonths * toNum(config.rewardPerGbPerPeriod))
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
    if (files.length <= 1) setSelectedProviders([])
  }, [files.length])

  const clearAllFiles = useCallback(() => {
    setFiles([])
    setSelectedProviders([])
  }, [])

  const handleConfirmStore = useCallback(async () => {
    if (!files.length || selectedProviders.length !== replicationCount) return
    setStoring(true)
    setStoreError(null)
    const now = new Date()
    const expires = new Date(now)
    expires.setMonth(expires.getMonth() + durationMonths)
    const providerEndpoints = selectedProviders
      .map((addr) => providers.find((p) => p.address === addr)?.endpoint)
      .filter(Boolean)

    const entries = files.map((f) => ({
      id: crypto.randomUUID?.() ?? `f-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      size: f.size,
      replicationCount,
      durationMonths,
      providers: [...selectedProviders],
      providerEndpoints: providerEndpoints.length ? providerEndpoints : undefined,
      uploadedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    }))

    if (!isSandboxMode() && providerEndpoints.length > 0) {
      const uploadResults = []
      for (let i = 0; i < files.length; i++) {
        const { succeeded, failed } = await uploadFileToProviders(
          providerEndpoints,
          files[i],
          entries[i].id
        )
        uploadResults.push({ succeeded, failed })
        entries[i].uploadedTo = succeeded.length ? succeeded : undefined
      }
      const anyFailed = uploadResults.some((r) => r.failed.length > 0)
      const allFailed = uploadResults.every((r) => r.succeeded.length === 0)
      if (allFailed) {
        setStoreError(
          'Aucun provider n\'a accepté le fichier (vérifiez les URLs, CORS et que le serveur est joignable).'
        )
        setStoring(false)
        return
      }
      if (anyFailed) {
        setStoreError(
          'Certains providers n\'ont pas répondu ; les fichiers ont été envoyés où c\'était possible.'
        )
      }
    }

    addStoredFiles(entries)
    setStoring(false)
    setConfirmOpen(false)
    setStoreError(null)
    clearAllFiles()
    navigate('/my-files')
  }, [files, selectedProviders, replicationCount, durationMonths, providers, clearAllFiles, navigate])

  const replicationOptions = Array.from({ length: 10 }, (_, i) => i + 1)

  const toggleProvider = useCallback((address) => {
    setSelectedProviders((prev) => {
      const idx = prev.indexOf(address)
      if (idx >= 0) return prev.filter((a) => a !== address)
      if (prev.length >= replicationCount) return prev
      return [...prev, address]
    })
  }, [replicationCount])

  const removeFromSlot = useCallback((index) => {
    setSelectedProviders((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const getReplicationIndex = (address) => {
    const idx = selectedProviders.indexOf(address)
    return idx >= 0 ? idx + 1 : null
  }
  const isProviderSelected = (address) => selectedProviders.includes(address)
  const canSelectMore = selectedProviders.length < replicationCount
  const hasFiles = files.length > 0
  const selectionComplete = hasFiles && selectedProviders.length === replicationCount
  const canStore = selectionComplete && !storing

  return (
    <div className="space-y-10">
      <div>
        <div className="border-l-2 border-accent pl-6">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-white sm:text-3xl">Upload</h1>
          <p className="mt-2 font-mono text-sm uppercase tracking-wide text-zinc-500">
            Déposez vos fichiers, réplications, durée, providers — puis validez.
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
            <div className="glass-panel geo-frame border border-line p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-300">Fichiers ({files.length})</h3>
                <button type="button" onClick={clearAllFiles} className="text-sm text-zinc-500 hover:text-red-400">Tout retirer</button>
              </div>
              <ul className="max-h-32 space-y-2 overflow-y-auto">
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
                  onChange={(e) => setReplicationCountAndTrim(Number(e.target.value))}
                  className="w-full border border-line bg-white/10 px-4 py-2 text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {replicationOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500">
                  Choisissez {replicationCount} provider(s) dans la liste à droite — cliquez sur une carte pour l’assigner à une réplication.
                </p>
              </div>

              {config && (
                <div className="glass-panel border border-line p-4">
                  <p className="text-sm text-zinc-500">Prix estimé</p>
                  <p className="text-2xl font-bold text-accent">
                    {priceMas.toFixed(4)} MAS
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {formatBytes(totalBytes)} × {replicationCount} répl. × {durationMonths} mois
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-500 mb-2">Durée (mensuelle)</label>
                <select value={durationMonths} onChange={(e) => setDurationMonths(Number(e.target.value))} className="w-full border border-line bg-white/10 px-4 py-2 text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent">
                  {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <p className="text-xs text-zinc-500">Choisissez {replicationCount} provider(s) à droite, puis Storer.</p>
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canStore} className="w-full border border-line bg-surface text-accent hover:border-accent py-3 text-sm font-semibold text-white hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed">Storer</button>
            </div>
          )}
        </section>

        {/* Slots de réplication + liste providers en cartes */}
        <section className="space-y-5">
          {hasFiles && (
            <div className="glass-panel geo-frame border border-line p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Vos réplications</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Cliquez sur un provider dans la liste ci-dessous pour l’assigner à une réplication. Cliquez à nouveau ou sur × pour retirer.
              </p>
              <ul className="space-y-2">
                {Array.from({ length: replicationCount }, (_, i) => {
                  const addr = selectedProviders[i]
                  return (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 border border-line bg-white/5 px-3 py-2"
                    >
                      <span className="text-sm font-medium text-zinc-500">Réplication {i + 1}</span>
                      {addr ? (
                        <>
                          <span className="font-mono text-sm text-zinc-200 truncate flex-1 text-center" title={addr}>
                            {truncateAddress(addr)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFromSlot(i)}
                            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-surface hover:text-red-400 transition"
                            aria-label="Retirer ce provider"
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <span className="text-sm text-zinc-500 italic flex-1 text-center">— Choisir un provider</span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {selectionComplete && (
                <p className="mt-3 text-xs text-accent font-medium">
                  Sélection complète — prêt pour le stockage.
                </p>
              )}
            </div>
          )}
          <div>
            <h2 className="mb-3 text-lg font-semibold text-zinc-200">Providers de stockage</h2>
            {loadingProviders ? (
              <div className="flex items-center gap-3 text-zinc-500">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                Chargement des providers…
              </div>
            ) : providersError ? (
              <div className="glass-panel geo-frame border border-line border-l-red-500/60 p-6 text-red-400/90">
                <p className="font-medium">Erreur chargement providers</p>
                <p className="mt-1 text-sm text-zinc-400">{providersError}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  Vérifiez que le contrat est déployé sur le buildnet et que VITE_STORAGE_REGISTRY_ADDRESS pointe vers la bonne adresse.
                </p>
              </div>
            ) : providers.length === 0 ? (
              <div className="glass-panel geo-frame border border-line p-6 text-zinc-500">
                <p>{isSandboxMode() ? 'Aucun provider listé pour le moment.' : 'Aucun provider enregistré sur le contrat (buildnet).'}</p>
                <p className="mt-1 text-sm text-zinc-500">
                  {isSandboxMode()
                    ? 'En mode bac à sable, une liste fictive est affichée.'
                    : 'Enregistrez des nœuds de stockage via le contrat pour qu\'ils apparaissent ici.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 max-h-[320px] overflow-y-auto pr-1">
                {providers.map((p) => {
                  const selected = isProviderSelected(p.address)
                  const repIndex = getReplicationIndex(p.address)
                  const disabled = !selected && !canSelectMore
                  return (
                    <button
                      key={p.address}
                      type="button"
                      onClick={hasFiles && !disabled ? () => toggleProvider(p.address) : undefined}
                      disabled={hasFiles ? disabled : true}
                      className={`glass-panel border border-line p-4 text-left transition ${
                        selected
                          ? 'border-accent ring-2 ring-accent/50 text-accent hover:border-accent/80'
                          : 'border-line hover:bg-white/5'
                      } ${hasFiles && !disabled ? 'cursor-pointer' : 'cursor-default opacity-70'}`}
                    >
                      {selected && repIndex && (
                        <span className="inline-block mb-2 rounded border border-line bg-surface text-accent hover:border-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
                          Réplication {repIndex}
                        </span>
                      )}
                      <p className="font-mono text-sm font-medium text-zinc-200 truncate" title={p.address}>
                        {truncateAddress(p.address)}
                      </p>
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
                    </button>
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
          <div className="glass-panel geo-frame w-full max-w-md border border-line p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title" className="text-lg font-semibold text-white">Confirmer le stockage</h2>
            {storeError && (
              <div className="mt-4 border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-400/90">
                {storeError}
              </div>
            )}
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-zinc-300"><strong>Fichiers :</strong> {files.length}</p>
              <ul className="max-h-24 overflow-y-auto border border-line bg-white/5 p-2 text-zinc-500">
                {files.map((f, i) => (
                  <li key={i} className="truncate">{f.name} — {formatBytes(f.size)}</li>
                ))}
              </ul>
              <p className="text-zinc-300"><strong>Réplications :</strong> {replicationCount}</p>
              <p className="text-zinc-300"><strong>Durée :</strong> {durationMonths} mois</p>
              <p className="text-zinc-300"><strong>Providers :</strong></p>
              <ul className="text-zinc-500 font-mono text-xs">
                {selectedProviders.map((addr, i) => (
                  <li key={i}>{i + 1}. {truncateAddress(addr)}</li>
                ))}
              </ul>
              <p className="border-t border-line pt-3 text-accent font-semibold">Total : {priceMas.toFixed(4)} MAS</p>
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

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { getStoredFiles, extendStoredFiles, removeStoredFiles } from '../lib/myFilesStorage'
import { getContractAddress } from '../contract/storageRegistryApi'
import { downloadAndSaveFromProvider } from '../lib/downloadFromProvider'
import { useWallet } from '../context/WalletContext'

// Même tarif que l'upload (StoreFiles) : nanoMAS / GB / mois
const REWARD_PER_GB_PER_MONTH = 500000000000

/** Calcule le prix de prolongation pour une entrée (nanoMAS). */
function extendPriceForEntry(entry, months) {
  const effectiveGb = entry.size > 0
    ? Math.max(entry.size / 1e9, 2 / 1024)
    : 2 / 1024
  const replicationCount = entry.providers?.length || entry.replicationCount || 1
  return BigInt(Math.ceil(effectiveGb * replicationCount * months * REWARD_PER_GB_PER_MONTH))
}

/** Calcule le total à payer et la répartition par provider pour une liste d'entrées. */
function computeExtendPayment(entries, months) {
  const byProvider = {}
  let totalNano = 0n
  for (const entry of entries) {
    const priceNano = extendPriceForEntry(entry, months)
    const providers = entry.providers?.filter(Boolean) || []
    if (providers.length === 0) continue
    totalNano += priceNano
    const perProvider = priceNano / BigInt(providers.length)
    if (perProvider > 0n) {
      for (const addr of providers) {
        byProvider[addr] = (byProvider[addr] || 0n) + perProvider
      }
    }
  }
  return { totalNano, byProvider }
}

function getDownloadContent(entry, formatBytes) {
  return `Fichier hébergé sur Massa Storage — ${entry.name}\nTaille: ${formatBytes(entry.size)}, ${entry.replicationCount} réplication(s).\nContenu réel récupérable auprès des providers de stockage.`
}

/** Téléchargement : depuis le provider si on a uploadedTo, sinon fichier placeholder (démo). */
function DownloadButton({ entry, formatBytes, className }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const canDownloadFromProvider = entry.uploadedTo?.length > 0 && entry.id

  const handleDownload = useCallback(async () => {
    if (canDownloadFromProvider) {
      setLoading(true)
      setError(null)
      const result = await downloadAndSaveFromProvider(
        entry.uploadedTo,
        entry.id,
        entry.name || 'fichier'
      )
      setLoading(false)
      if (!result.ok) setError(result.error)
      return
    }
    // Fallback : fichier texte placeholder si pas d'uploadedTo
    const content = getDownloadContent(entry, formatBytes)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name || 'fichier'
    a.click()
    URL.revokeObjectURL(url)
  }, [entry, formatBytes, canDownloadFromProvider])

  if (loading) {
    return <span className={`${className} opacity-70`}>Téléchargement…</span>
  }
  return (
    <>
      <button
        type="button"
        onClick={handleDownload}
        className={className}
        title={canDownloadFromProvider ? 'Télécharger le fichier depuis le provider' : 'Télécharger (fichier de démo)'}
      >
        Télécharger
      </button>
      {error && (
        <span className="text-red-400 text-xs ml-1" title={error}>
          Échec
        </span>
      )}
    </>
  )
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

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function CopyIcon({ className = '', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

const EXTEND_OPTIONS = [
  { value: 1, label: '+ 1 mois' },
  { value: 3, label: '+ 3 mois' },
  { value: 6, label: '+ 6 mois' },
  { value: 12, label: '+ 12 mois' },
]

export function MyFiles() {
  const { connected, account, address } = useWallet()
  const [list, setList] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [extending, setExtending] = useState(false)
  const [extendMonths, setExtendMonths] = useState(1)
  const [extendConfirm, setExtendConfirm] = useState(null)
  const [extendError, setExtendError] = useState(null)
  const [copiedEntryId, setCopiedEntryId] = useState(null)

  const load = useCallback(() => {
    setList(getStoredFiles(address ?? null))
  }, [address])

  useEffect(() => {
    load()
  }, [load])

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === list.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(list.map((e) => e.id)))
  }

  const entriesToExtend = useCallback((ids) => {
    const idSet = new Set(ids)
    return list.filter((e) => idSet.has(e.id))
  }, [list])

  const handleExtendSelected = () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    const entries = entriesToExtend(ids)
    const { totalNano, byProvider } = computeExtendPayment(entries, extendMonths)
    const needsPayment = totalNano > 0n && Object.keys(byProvider).length > 0
    if (needsPayment && connected && account) {
      setExtendError(null)
      setExtendConfirm({ ids, months: extendMonths, totalNano, byProvider })
      return
    }
    if (needsPayment && !connected) {
      setExtendError('Connectez votre wallet pour payer la prolongation.')
      return
    }
    setExtending(true)
    if (address) extendStoredFiles(address, ids, extendMonths)
    setExtending(false)
    setSelectedIds(new Set())
    load()
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return
    if (address) removeStoredFiles(address, [...selectedIds])
    setSelectedIds(new Set())
    load()
  }

  const copyAllProviders = (entry) => {
    const addrs = entry.providers?.filter(Boolean) || []
    if (addrs.length === 0) return
    navigator.clipboard?.writeText(addrs.length === 1 ? addrs[0] : addrs.join('\n'))
    setCopiedEntryId(entry.id)
    setTimeout(() => setCopiedEntryId(null), 2000)
  }

  const handleExtendOne = (id) => {
    const entry = list.find((e) => e.id === id)
    if (!entry) return
    const entries = [entry]
    const months = 1
    const { totalNano, byProvider } = computeExtendPayment(entries, months)
    const needsPayment = totalNano > 0n && Object.keys(byProvider).length > 0
    if (needsPayment && connected && account) {
      setExtendError(null)
      setExtendConfirm({ ids: [id], months, totalNano, byProvider })
      return
    }
    if (needsPayment && !connected) {
      setExtendError('Connectez votre wallet pour payer la prolongation.')
      return
    }
    setExtending(true)
    if (address) extendStoredFiles(address, [id], months)
    setExtending(false)
    load()
  }

  const handleExtendConfirm = useCallback(async () => {
    if (!extendConfirm || !account) return
    const { ids, months, totalNano } = extendConfirm
    setExtending(true)
    setExtendError(null)
    try {
      if (totalNano > 0n) {
        const contractAddress = getContractAddress()
        await account.transfer(contractAddress, totalNano)
      }
      if (address) extendStoredFiles(address, ids, months)
      setExtendConfirm(null)
      setSelectedIds(new Set())
      load()
    } catch (e) {
      setExtendError(e?.message ?? 'Paiement refusé ou échoué. Vérifiez votre solde.')
    } finally {
      setExtending(false)
    }
  }, [extendConfirm, account, address, load])

  const handleExtendCancel = useCallback(() => {
    setExtendConfirm(null)
    setExtendError(null)
  }, [])

  const handleDeleteOne = (id) => {
    if (address) removeStoredFiles(address, [id])
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    load()
  }

  const isExpired = (expiresAt) => new Date(expiresAt) < new Date()

  const extendModal = extendConfirm && createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onClick={handleExtendCancel}>
      <div className="card-panel max-w-md w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white border-b border-line pb-3">Prolongation</h3>
        <p className="mt-3 text-sm text-zinc-400">
          Prolonger {extendConfirm.ids.length} fichier(s) de <strong className="text-white">{extendConfirm.months} mois</strong>.
        </p>
        <p className="mt-2 text-accent font-mono font-semibold">
          Total : {(Number(extendConfirm.totalNano) / 1e9).toFixed(4)} MAS
        </p>
        {extendError && (
          <p className="mt-2 text-sm text-red-400">{extendError}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleExtendConfirm}
            disabled={extending}
            className="font-mono text-xs uppercase tracking-wide text-amber-400 hover:text-amber-300 disabled:opacity-50 border border-amber-400/50 px-4 py-2 hover:border-amber-400"
          >
            {extending ? 'Paiement…' : 'Payer et prolonger'}
          </button>
          <button
            type="button"
            onClick={handleExtendCancel}
            disabled={extending}
            className="font-mono text-xs uppercase tracking-wide border border-line px-4 py-2 text-zinc-400 hover:text-white hover:border-zinc-400 disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>,
    document.body
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="border-l-2 border-accent pl-6">
          <h1 className="text-xl font-semibold tracking-tight text-white">My Files</h1>
          <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
            Fichiers hébergés. Prolongez en lot.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Fichiers que vous avez hébergés et signés avec votre adresse (enregistrés localement par wallet). Télécharger récupère le fichier chez le provider.
          </p>
        </div>
        <Link
          to="/upload"
          className="border border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-white hover:border-accent hover:text-accent"
        >
          Upload
        </Link>
      </div>

      {!address && (
        <div className="card-panel p-4 border-line bg-surface/80">
          <p className="text-sm text-zinc-400">
            Connectez votre wallet pour voir les fichiers que vous avez hébergés et signés avec votre adresse.
          </p>
        </div>
      )}

      {extendError && !extendConfirm && (
        <div className="card-panel p-4 border-red-500/30 bg-red-500/5">
          <p className="text-sm text-red-400">{extendError}</p>
          <button type="button" onClick={() => setExtendError(null)} className="mt-2 text-xs text-zinc-500 hover:text-white">Fermer</button>
        </div>
      )}
      {list.length === 0 ? (
        <div className="card-panel p-12 text-center">
          <p className="text-zinc-500">Aucun fichier hébergé.</p>
          <Link to="/upload" className="mt-4 inline-block text-xs uppercase tracking-wide text-accent hover:underline">
            Upload →
          </Link>
        </div>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="card-panel flex flex-wrap items-center gap-3 border-accent/30 p-4">
              <span className="text-sm text-accent">{selectedIds.size} fichier(s) sélectionné(s)</span>
              <select
                value={extendMonths}
                onChange={(e) => setExtendMonths(Number(e.target.value))}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-white [color-scheme:dark]"
              >
                {EXTEND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleExtendSelected}
                disabled={extending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {extending ? 'En cours…' : 'Prolonger la sélection'}
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="rounded-lg border border-red-500/60 px-4 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20"
              >
                Supprimer la sélection
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-sm text-zinc-500 hover:text-slate-200">
                Annuler
              </button>
            </div>
          )}

          <div className="card-panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <label className="file-checkbox-wrap">
                      <input
                        type="checkbox"
                        checked={list.length > 0 && selectedIds.size === list.length}
                        onChange={toggleSelectAll}
                      />
                      <span className="file-checkbox-box" aria-hidden />
                    </label>
                  </th>
                  <th className="px-4 py-3 font-medium">Fichier</th>
                  <th className="px-4 py-3 font-medium">Taille</th>
                  <th className="px-4 py-3 font-medium">Répl.</th>
                  <th className="px-4 py-3 font-medium">Durée</th>
                  <th className="px-4 py-3 font-medium">Hébergé chez</th>
                  <th className="px-4 py-3 font-medium">Expire le</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => (
                  <tr key={entry.id} className="border-t border-line hover:bg-surface">
                    <td className="px-4 py-3">
                      <label className="file-checkbox-wrap">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelect(entry.id)}
                        />
                        <span className="file-checkbox-box" aria-hidden />
                      </label>
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{entry.name}</td>
                    <td className="px-4 py-3 text-zinc-500">{formatBytes(entry.size)}</td>
                    <td className="px-4 py-3 text-zinc-500">{entry.replicationCount}</td>
                    <td className="px-4 py-3 text-zinc-500">{entry.durationMonths} mois</td>
                    <td className="px-4 py-3">
                      {entry.providers?.length ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-zinc-500" title={entry.providers[0]}>
                            {truncateAddress(entry.providers[0])}{entry.providers.length > 1 ? ` +${entry.providers.length - 1}` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyAllProviders(entry)}
                            className="p-1.5 text-zinc-500 hover:text-accent transition-colors rounded"
                            title={entry.providers.length === 1 ? 'Copier l\'adresse' : 'Copier toutes les adresses'}
                          >
                            <CopyIcon className="w-4 h-4" />
                          </button>
                          {copiedEntryId === entry.id && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
                              Copié <span aria-hidden>✓</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 ${isExpired(entry.expiresAt) ? 'text-red-400' : 'text-zinc-500'}`}>
                      {formatDate(entry.expiresAt)}
                      {isExpired(entry.expiresAt) && ' (expiré)'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleExtendOne(entry.id)}
                          disabled={extending}
                          className="font-mono text-xs uppercase tracking-wide text-amber-400 hover:text-amber-300 disabled:opacity-50"
                          title="Prolonger l'hébergement de 1 mois"
                        >
                          Prolonger
                        </button>
                        <DownloadButton
                          entry={entry}
                          formatBytes={formatBytes}
                          className="font-mono text-xs uppercase tracking-wide text-accent hover:underline"
                        />
                        <button
                          type="button"
                          onClick={() => handleDeleteOne(entry.id)}
                          className="font-mono text-xs uppercase tracking-wide text-red-400/90 hover:underline"
                          title="Supprimer de ma liste"
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {extendModal}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStoredFiles, extendStoredFiles, removeStoredFiles, getSandboxMockFiles } from '../lib/myFilesStorage'
import { isSandboxMode } from '../contract/storageRegistryApi'

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

const EXTEND_OPTIONS = [
  { value: 1, label: '+ 1 mois' },
  { value: 3, label: '+ 3 mois' },
  { value: 6, label: '+ 6 mois' },
  { value: 12, label: '+ 12 mois' },
]

export function MyFiles() {
  const sandbox = isSandboxMode()
  const [list, setList] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [extending, setExtending] = useState(false)
  const [extendMonths, setExtendMonths] = useState(1)

  const HIDDEN_MOCKS_KEY = 'massa-storage-hidden-mocks'

  const load = useCallback(() => {
    const stored = getStoredFiles()
    let list = sandbox && stored.length === 0 ? getSandboxMockFiles() : stored
    if (sandbox && stored.length === 0) {
      try {
        const hidden = sessionStorage.getItem(HIDDEN_MOCKS_KEY)
        const hiddenIds = hidden ? JSON.parse(hidden) : []
        list = list.filter((e) => !hiddenIds.includes(e.id))
      } catch (_) {}
    }
    setList(list)
  }, [sandbox])

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

  const handleExtendSelected = () => {
    if (selectedIds.size === 0) return
    setExtending(true)
    extendStoredFiles([...selectedIds], extendMonths)
    setExtending(false)
    setSelectedIds(new Set())
    load()
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    if (sandbox && getStoredFiles().length === 0) {
      try {
        const hidden = sessionStorage.getItem(HIDDEN_MOCKS_KEY)
        const hiddenIds = hidden ? JSON.parse(hidden) : []
        ids.forEach((id) => hiddenIds.push(id))
        sessionStorage.setItem(HIDDEN_MOCKS_KEY, JSON.stringify(hiddenIds))
      } catch (_) {}
    } else {
      removeStoredFiles(ids)
    }
    setSelectedIds(new Set())
    load()
  }

  const handleDeleteOne = (id) => {
    if (sandbox && getStoredFiles().length === 0) {
      try {
        const hidden = sessionStorage.getItem(HIDDEN_MOCKS_KEY)
        const hiddenIds = hidden ? JSON.parse(hidden) : []
        if (!hiddenIds.includes(id)) hiddenIds.push(id)
        sessionStorage.setItem(HIDDEN_MOCKS_KEY, JSON.stringify(hiddenIds))
      } catch (_) {}
    } else {
      removeStoredFiles([id])
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    load()
  }

  /** Téléchargement : fichier placeholder (contenu réel = récupération auprès des providers). */
  const handleDownload = (entry) => {
    const content = `Fichier hébergé sur Massa Storage — ${entry.name}\nTaille: ${formatBytes(entry.size)}, ${entry.replicationCount} réplication(s).\nContenu réel récupérable auprès des providers de stockage.`
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name || 'fichier'
    a.click()
    URL.revokeObjectURL(url)
  }

  const isExpired = (expiresAt) => new Date(expiresAt) < new Date()

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="border-l-2 border-accent pl-6">
          <h1 className="text-xl font-semibold tracking-tight text-white">My Files</h1>
          <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
            Fichiers hébergés. Prolongez en lot.
          </p>
        </div>
        <Link
          to="/upload"
          className="border border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-white hover:border-accent hover:text-accent"
        >
          Upload
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="glass-panel geo-frame border border-line p-12 text-center">
          <p className="text-zinc-500">Aucun fichier hébergé.</p>
          <Link to="/upload" className="mt-4 inline-block text-xs uppercase tracking-wide text-accent hover:underline">
            Upload →
          </Link>
        </div>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="glass-panel flex flex-wrap items-center gap-3 border border-accent/30 p-4">
              <span className="text-sm text-accent">{selectedIds.size} fichier(s) sélectionné(s)</span>
              <select
                value={extendMonths}
                onChange={(e) => setExtendMonths(Number(e.target.value))}
                className="rounded-lg border border-line bg-white/10 px-3 py-1.5 text-sm text-white"
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

          <div className="glass-panel overflow-x-auto border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-zinc-500">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={list.length > 0 && selectedIds.size === list.length}
                      onChange={toggleSelectAll}
                      className="rounded border-line-strong bg-surface text-accent"
                    />
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
                      <input
                        type="checkbox"
                        checked={selectedIds.has(entry.id)}
                        onChange={() => toggleSelect(entry.id)}
                        className="rounded border-line-strong bg-surface text-accent"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{entry.name}</td>
                    <td className="px-4 py-3 text-zinc-500">{formatBytes(entry.size)}</td>
                    <td className="px-4 py-3 text-zinc-500">{entry.replicationCount}</td>
                    <td className="px-4 py-3 text-zinc-500">{entry.durationMonths} mois</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-zinc-500" title={entry.providers?.[0]}>
                        {entry.providers?.length ? truncateAddress(entry.providers[0]) + (entry.providers.length > 1 ? ` +${entry.providers.length - 1}` : '') : '—'}
                      </span>
                    </td>
                    <td className={`px-4 py-3 ${isExpired(entry.expiresAt) ? 'text-red-400' : 'text-zinc-500'}`}>
                      {formatDate(entry.expiresAt)}
                      {isExpired(entry.expiresAt) && ' (expiré)'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownload(entry)}
                          className="font-mono text-xs uppercase tracking-wide text-accent hover:underline"
                        >
                          Télécharger
                        </button>
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
    </div>
  )
}

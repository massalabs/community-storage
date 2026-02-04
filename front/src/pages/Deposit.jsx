import { useCallback, useEffect, useState } from 'react'
import { getConfig } from '../contract/storageRegistryApi'

function formatMas(nano) {
  if (nano === undefined || nano === null) return '…'
  const n = typeof nano === 'bigint' ? Number(nano) : nano
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })} MAS`
  return `${(n / 1e9).toFixed(4)} MAS`
}

function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`
  return `${bytes} B`
}

export function Deposit() {
  const [config, setConfig] = useState(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    let cancelled = false
    getConfig()
      .then((c) => { if (!cancelled) setConfig(c) })
      .catch(() => { if (!cancelled) setConfig(null) })
      .finally(() => { if (!cancelled) setLoadingConfig(false) })
    return () => { cancelled = true }
  }, [])

  const addFiles = useCallback((newFiles) => {
    if (!newFiles?.length) return
    const list = Array.from(newFiles).map((file) => ({
      file,
      name: file.name,
      size: file.size,
    }))
    setFiles((prev) => [...prev, ...list])
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setIsDragging(false)
      addFiles(e.dataTransfer?.files)
    },
    [addFiles]
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false)
  }, [])

  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearAll = useCallback(() => setFiles([]), [])
  const triggerBrowse = useCallback(() => {
    document.getElementById('deposit-file-input')?.click()
  }, [])

  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0)
  const totalGb = totalBytes / 1e9
  const rewardPerGb = config?.rewardPerGbPerPeriod ?? 0n
  const rewardNum = typeof rewardPerGb === 'bigint' ? Number(rewardPerGb) : rewardPerGb
  const priceNano = totalGb * rewardNum
  const priceMas = priceNano / 1e9

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Deposit</h1>
        <p className="mt-1 text-slate-400">
          Drop your files to see the estimated storage cost (same rate as rewards per GB per period).
        </p>
      </div>

      <section>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/30 p-10 text-center transition-colors ${
            isDragging
              ? 'border-amber-500/60 bg-amber-500/10'
              : 'border-slate-500 hover:border-slate-400'
          }`}
        >
          <input
            id="deposit-file-input"
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <p className="text-slate-300">
            Drag and drop files here, or{' '}
            <button
              type="button"
              onClick={triggerBrowse}
              className="text-amber-400 hover:underline"
            >
              click to browse
            </button>
            .
          </p>
          <p className="mt-1 text-sm text-slate-500">Multiple files supported</p>
        </div>
      </section>

      {files.length > 0 && (
        <>
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-200">Files ({files.length})</h2>
              <button
                type="button"
                onClick={clearAll}
                className="text-sm text-slate-500 hover:text-red-400"
              >
                Clear all
              </button>
            </div>
            <ul className="scrollbar-app mt-3 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-600 bg-slate-800/50 p-3">
              {files.map((item, index) => (
                <li
                  key={`${item.name}-${index}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                >
                  <span className="truncate font-medium text-slate-200" title={item.name}>
                    {item.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-slate-500">{formatSize(item.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-red-400"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6">
            <h2 className="text-lg font-semibold text-amber-200">Estimated cost</h2>
            <p className="mt-2 text-2xl font-bold text-amber-400">
              {loadingConfig ? '…' : `${priceMas.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })} MAS`}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              per period · {formatSize(totalBytes)} total
              {config && (
                <> · {formatMas(rewardPerGb)} / GB / period</>
              )}
            </p>
          </section>
        </>
      )}
    </div>
  )
}

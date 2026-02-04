import { useEffect, useState, useCallback } from 'react'
import { useWallet } from '../context/WalletContext'
import { useTheme } from '../context/ThemeContext'
import { getBlocklist, setBlocklist } from '../lib/blocklistStorage'

export function Settings() {
  const { address, connected } = useWallet()
  const { theme, setTheme, isLight } = useTheme()
  const [blocklistInput, setBlocklistInput] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (address) {
      setBlocklistInput(getBlocklist(address).join('\n'))
    } else {
      setBlocklistInput('')
    }
  }, [address])

  const saveBlocklist = useCallback(() => {
    if (!address) return
    const list = setBlocklist(address, blocklistInput)
    setBlocklistInput(list.join('\n'))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [address, blocklistInput])

  const showBlocklist = connected && address

  return (
    <div className="space-y-10">
      <div className="border-l-2 border-accent pl-6">
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-white sm:text-3xl">Settings</h1>
        <p className="mt-2 font-mono text-sm uppercase tracking-wide text-zinc-500">
          Préférences de l’application.
        </p>
      </div>

      <div className="card-panel p-6 max-w-2xl">
        <h2 className="text-lg font-semibold text-zinc-200 mb-1">Apparence</h2>
        <p className="text-xs text-zinc-500 mb-3">Paramètre global (non lié au wallet).</p>
        <div className="flex items-center justify-between gap-4 py-3 border-b border-line">
          <span className="text-sm text-zinc-400">Mode clair</span>
          <button
            type="button"
            role="switch"
            aria-checked={isLight}
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg ${isLight ? 'bg-accent' : 'bg-zinc-600'}`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 shrink-0 transform rounded-full bg-white shadow ring-0 transition-transform ${isLight ? 'translate-x-5' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>

      {showBlocklist ? (
        <div className="card-panel p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-zinc-200 mb-1">Providers exclus (blocklist)</h2>
          <p className="text-xs text-zinc-500 mb-3">Lié à ce wallet — une liste différente par adresse.</p>
          <p className="text-sm text-zinc-500 mb-4">
            Une adresse par ligne. Ces providers ne seront jamais choisis automatiquement pour héberger vos fichiers.
          </p>
          <textarea
            value={blocklistInput}
            onChange={(e) => setBlocklistInput(e.target.value)}
            placeholder="AU12...&#10;AS1..."
            rows={8}
            className="w-full border border-line bg-surface px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent [color-scheme:dark] font-mono resize-y"
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={saveBlocklist}
              className="font-mono text-xs uppercase tracking-wide border border-line px-4 py-2 text-zinc-400 hover:text-white hover:border-zinc-400 transition-colors"
            >
              {saved ? 'Enregistré' : 'Enregistrer'}
            </button>
            {saved && <span className="text-sm text-emerald-500">Sauvegardé</span>}
          </div>
        </div>
      ) : (
        <div className="card-panel p-6 max-w-2xl">
          <h2 className="text-lg font-semibold text-zinc-200 mb-1">Providers exclus (blocklist)</h2>
          <p className="text-xs text-zinc-500 mb-3">Réglage lié au wallet.</p>
          <p className="text-zinc-400">Connectez votre wallet pour gérer la blocklist (une liste par adresse).</p>
        </div>
      )}
    </div>
  )
}


import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import { isSandboxMode, setSandboxMode } from '../contract/storageRegistryApi'
import { FloatingFileIcons } from './FloatingFileIcons'
import { SandboxBanner } from './SandboxBanner'
import { SnakeTrails } from './SnakeTrail'
import { SonarDots } from './SonarDots'
import { SandboxOnly } from './SandboxOnly'

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`
}

function formatBalance(nano) {
  if (nano === undefined || nano === null) return '…'
  const n = typeof nano === 'bigint' ? Number(nano) : nano
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} MAS`
  return `${(n / 1e9).toFixed(4)} MAS`
}

export function Layout({ children }) {
  const [accountBalances, setAccountBalances] = useState({})
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const {
    address,
    account,
    connected,
    connecting,
    error,
    openWalletPicker,
    closeWalletPicker,
    connectWith,
    disconnect,
    walletPickerOpen,
    availableWallets,
    getWalletLabel,
    accountPickerOpen,
    availableAccounts,
    selectAccount,
    closeAccountPicker,
    openAccountPicker,
  } = useWallet()
  const location = useLocation()
  const pathname = location?.pathname ?? '/'
  const adminAddress = (import.meta.env.VITE_ADMIN_ADDRESS || 'AU12KpB8wn2Sr3tE3TbtUZ4V1ouGjRmVcmcb6FqfgkM1kUZZPaWLV').trim()
  const isAdmin = !!adminAddress && connected && (address?.toLowerCase() === adminAddress?.toLowerCase())

  function getAccountLabel(account) {
    return account?.accountName ?? account?.nickname ?? truncateAddress(account?.address) ?? 'Compte'
  }

  useEffect(() => {
    if (!accountPickerOpen || !availableAccounts?.length) {
      setAccountBalances({})
      return
    }
    let cancelled = false
    const balances = {}
    Promise.all(
      availableAccounts.map(async (acc) => {
        if (!acc?.address) return
        try {
          const bal = typeof acc.balance === 'function' ? await acc.balance(true) : null
          if (!cancelled) balances[acc.address] = bal
        } catch {
          if (!cancelled) balances[acc.address] = null
        }
      })
    ).then(() => {
      if (!cancelled) setAccountBalances(balances)
    })
    return () => { cancelled = true }
  }, [accountPickerOpen, availableAccounts])

  const sandbox = isSandboxMode()
  const showModeToggle = import.meta.env.DEV

  return (
    <div className="relative min-h-screen grid-bg bg-bg text-zinc-100">
      <FloatingFileIcons />
      <SnakeTrails />
      <SonarDots />
      <div className="relative z-10">
      {sandbox && <SandboxBanner />}
      {showModeToggle && !sandbox && (
        <div className="border-b border-line border-l-2 border-l-emerald-500/80 bg-emerald-500/10 px-6 py-2 text-center font-mono text-xs uppercase tracking-wide text-emerald-400/90">
          Mode réel — Buildnet
        </div>
      )}
      <header className="glass-panel border-b border-line">
        <div className="mx-auto flex max-w-content items-center justify-between gap-grid px-6 py-4">
          <Link
            to="/"
            className="font-mono text-2xl font-semibold tracking-tight text-white hover:text-accent transition-colors sm:text-3xl"
          >
            MASSA STORAGE
          </Link>
          <nav className="flex items-center gap-6 font-mono text-base">
            {showModeToggle && (
              <>
                <div className="flex items-center gap-1 uppercase tracking-wide text-zinc-500">
                  <button
                    type="button"
                    onClick={() => setSandboxMode(false)}
                    className={`px-2 py-1 ${!sandbox ? 'text-accent' : 'hover:text-zinc-400'}`}
                  >
                    Réelles
                  </button>
                  <span className="vertical-sep mx-1" />
                  <button
                    type="button"
                    onClick={() => setSandboxMode(true)}
                    className={`px-2 py-1 ${sandbox ? 'text-accent' : 'hover:text-zinc-400'}`}
                  >
                    Bac à sable
                  </button>
                </div>
                <span className="vertical-sep" />
              </>
            )}
            <Link
              to="/provide-storage"
              className={`uppercase tracking-wide transition-colors ${pathname === '/provide-storage' ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Provide Storage
            </Link>
            <Link
              to="/my-files"
              className={`uppercase tracking-wide transition-colors ${pathname === '/my-files' ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              My Files
            </Link>
            <SandboxOnly>
              <Link
                to="/sandbox"
                className={`uppercase tracking-wide transition-colors ${pathname === '/sandbox' ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Expériences
              </Link>
            </SandboxOnly>
            {isAdmin && (
              <Link
                to="/admin"
                className={`uppercase tracking-wide transition-colors ${pathname === '/admin' ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Admin
              </Link>
            )}
            <span className="vertical-sep" />
            <Link
              to="/upload"
              className={`font-medium uppercase tracking-wide transition-colors ${pathname === '/upload' ? 'text-accent' : 'text-zinc-400 hover:text-accent'}`}
            >
              Upload
            </Link>
            {error && !connected && (
              <span className="text-base text-red-400/90" title={error}>{error.slice(0, 24)}…</span>
            )}
            {connected ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setWalletMenuOpen((o) => !o)}
                  className="font-mono tabular-nums text-zinc-300 hover:text-accent transition-colors border border-white/[0.08] hover:border-line px-3 py-2 rounded"
                  title={address}
                >
                  {getAccountLabel(account) || truncateAddress(address)}
                </button>
                {walletMenuOpen && createPortal(
                  <>
                    <div
                      className="fixed inset-0 z-[99998] bg-black/20"
                      aria-hidden="true"
                      onClick={() => setWalletMenuOpen(false)}
                    />
                    <div
                      className="card-panel fixed right-6 top-[4.5rem] z-[99999] min-w-[220px] p-3"
                      role="dialog"
                      aria-label="Menu wallet"
                    >
                      {error && (
                        <p className="mb-2 text-xs text-red-400/90" title={error}>
                          {error.slice(0, 40)}{error.length > 40 ? '…' : ''}
                        </p>
                      )}
                      <div className="mb-3">
                        <div className="font-mono text-sm font-medium text-white truncate">
                          {getAccountLabel(account) || 'Compte'}
                        </div>
                        <div className="font-mono text-xs text-zinc-500" title={address}>
                          {truncateAddress(address)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(address)
                          setWalletMenuOpen(false)
                        }}
                        className="geo-frame w-full border-y border-r border-line bg-white/5 py-2.5 px-3 text-left text-sm text-zinc-300 hover:bg-white/10 transition-colors uppercase tracking-wide"
                      >
                        Copier l'adresse
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWalletMenuOpen(false)
                          openAccountPicker()
                        }}
                        className="geo-frame mt-1.5 w-full border-y border-r border-line bg-white/5 py-2.5 px-3 text-left text-sm text-zinc-300 hover:bg-white/10 transition-colors uppercase tracking-wide"
                      >
                        Changer de compte
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWalletMenuOpen(false)
                          disconnect()
                        }}
                        className="geo-frame mt-1.5 w-full border-y border-r border-line bg-white/5 py-2.5 px-3 text-left text-sm text-red-400/90 hover:bg-red-500/10 transition-colors uppercase tracking-wide"
                      >
                        Déconnexion
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={openWalletPicker}
                disabled={connecting}
                className="font-mono border border-line bg-surface px-5 py-2.5 font-medium uppercase tracking-wide text-white hover:border-accent/50 hover:text-accent disabled:opacity-50 transition-colors"
              >
                {connecting ? '…' : 'Connect wallet'}
              </button>
            )}
          </nav>
        </div>
      </header>

      {accountPickerOpen && (
        <div className="glass-overlay fixed inset-0 z-50 flex items-center justify-center" onClick={closeAccountPicker} role="dialog" aria-modal="true" aria-label="Choisir un compte">
          <div className="card-panel w-full max-w-md p-8" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-mono text-lg font-semibold uppercase tracking-wide text-white">Choisir un compte</h3>
            <p className="mt-2 text-xs text-zinc-500">
              Plusieurs comptes trouvés. Sélectionnez celui à utiliser.
            </p>
            <ul className="mt-6 space-y-2">
              {availableAccounts.map((acc, i) => (
                <li key={acc?.address ?? i}>
                  <button
                    type="button"
                    onClick={() => selectAccount(acc)}
                    className="geo-frame flex w-full flex-col items-start border-y border-r border-line bg-white/5 p-4 text-left hover:bg-white/10 transition-colors"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white truncate">{getAccountLabel(acc)}</span>
                      <span className="text-xs tabular-nums text-accent">
                        {formatBalance(accountBalances[acc?.address])}
                      </span>
                    </div>
                    <span className="mt-1 font-mono text-xs text-zinc-500" title={acc?.address}>
                      {truncateAddress(acc?.address)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={closeAccountPicker} className="font-mono mt-6 w-full border border-line py-3 text-base uppercase tracking-wide text-zinc-500 hover:text-zinc-300 hover:border-line-strong transition-colors">
              Annuler
            </button>
          </div>
        </div>
      )}

      {walletPickerOpen && (
        <div className="glass-overlay fixed inset-0 z-50 flex items-center justify-center" onClick={closeWalletPicker} role="dialog" aria-modal="true" aria-label="Choisir un wallet">
          <div className="card-panel w-full max-w-sm p-8" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-mono text-lg font-semibold uppercase tracking-wide text-white">Choisir un wallet</h3>
            <p className="mt-2 text-xs text-zinc-500">
              Massa Station ou Bearby.
            </p>
            <ul className="mt-6 space-y-2">
              {availableWallets.length === 0 ? (
                <li className="py-8 text-center text-xs text-zinc-500">Détection…</li>
              ) : (
                availableWallets.map((w, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => connectWith(w)}
                      disabled={connecting}
                      className="geo-frame flex w-full items-center justify-between border-y border-r border-line bg-white/5 p-4 text-left text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
                    >
                      <span className="text-sm font-medium">{getWalletLabel(w)}</span>
                      {connecting ? <span className="text-xs text-zinc-500">…</span> : <span className="text-accent">→</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button type="button" onClick={closeWalletPicker} className="font-mono mt-6 w-full border border-line py-3 text-base uppercase tracking-wide text-zinc-500 hover:text-zinc-300 hover:border-line-strong transition-colors">
              Annuler
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-content px-6 py-12">{children}</main>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import { isSandboxMode, setSandboxMode } from '../contract/storageRegistryApi'
import { SandboxBanner } from './SandboxBanner'
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
  const [
    accountBalances,
    setAccountBalances,
  ] = useState({})
  const {
    address,
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
  } = useWallet()
  const location = useLocation()
  const pathname = location?.pathname ?? '/'
  // Adresse admin : .env ou fallback (déployeur du contrat buildnet)
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
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {sandbox && <SandboxBanner />}
      <header className="border-b border-slate-700">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="text-xl font-semibold text-white hover:text-amber-400/90">
            Massa Storage
          </Link>
          <nav className="flex flex-wrap items-center gap-4 sm:gap-6">
            {showModeToggle && (
              <div className="flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-800/50 p-1">
                <span className="px-2 text-xs text-slate-500">Données :</span>
                <button
                  type="button"
                  onClick={() => setSandboxMode(false)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${!sandbox ? 'bg-amber-500/20 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Réelles
                </button>
                <button
                  type="button"
                  onClick={() => setSandboxMode(true)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${sandbox ? 'bg-amber-500/20 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Bac à sable
                </button>
              </div>
            )}
            <Link
              to="/"
              className={`text-sm font-medium ${pathname === '/' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Home
            </Link>
            <Link
              to="/dashboard"
              className={`text-sm font-medium ${pathname === '/dashboard' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Dashboard
            </Link>
            <Link
              to="/my-dashboard"
              className={`text-sm font-medium ${pathname === '/my-dashboard' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              My Dashboard
            </Link>
            <SandboxOnly>
              <Link
                to="/sandbox"
                className={`text-sm font-medium ${pathname === '/sandbox' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Expériences
              </Link>
            </SandboxOnly>
            {isAdmin && (
              <Link
                to="/admin"
                className={`text-sm font-medium ${pathname === '/admin' ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Admin
              </Link>
            )}
            <div className="flex items-center gap-3">
              {error && (
                <span className="text-xs text-red-400" title={error}>
                  {error.slice(0, 30)}…
                </span>
              )}
              {connected ? (
                <>
                  <span className="rounded bg-slate-700 px-3 py-1.5 font-mono text-sm text-slate-200" title={address}>
                    {truncateAddress(address)}
                  </span>
                  <button
                    type="button"
                    onClick={disconnect}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    Déconnexion
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={openWalletPicker}
                  disabled={connecting}
                  className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {connecting ? 'Connexion…' : 'Connexion wallet'}
                </button>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Modal choix du compte (Massa Station : plusieurs comptes) */}
      {accountPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeAccountPicker}
          role="dialog"
          aria-modal="true"
          aria-label="Choisir un compte"
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-800 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Choisir un compte</h3>
            <p className="mt-1 text-sm text-slate-400">
              Plusieurs comptes trouvés. Sélectionnez celui à utiliser.
            </p>
            <ul className="mt-4 space-y-2">
              {availableAccounts.map((acc, i) => (
                <li key={acc?.address ?? i}>
                  <button
                    type="button"
                    onClick={() => selectAccount(acc)}
                    className="flex w-full flex-col items-start rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-3 text-left hover:bg-slate-700"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-medium text-white">{getAccountLabel(acc)}</span>
                      <span className="shrink-0 text-sm font-medium text-amber-400">
                        {formatBalance(accountBalances[acc?.address])}
                      </span>
                    </div>
                    <span className="mt-0.5 font-mono text-xs text-slate-400" title={acc?.address}>
                      {truncateAddress(acc?.address)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={closeAccountPicker}
              className="mt-4 w-full rounded-lg border border-slate-600 py-2 text-sm font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Modal choix du wallet */}
      {walletPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeWalletPicker}
          role="dialog"
          aria-modal="true"
          aria-label="Choisir un wallet"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-600 bg-slate-800 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Choisir un wallet</h3>
            <p className="mt-1 text-sm text-slate-400">
              Connectez-vous avec Massa Station ou Bearby.
            </p>
            <ul className="mt-4 space-y-2">
              {availableWallets.length === 0 ? (
                <li className="py-4 text-center text-sm text-slate-500">
                  Détection des wallets…
                </li>
              ) : (
                availableWallets.map((w, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => connectWith(w)}
                      disabled={connecting}
                      className="flex w-full items-center justify-between rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-3 text-left text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      <span className="font-medium">{getWalletLabel(w)}</span>
                      {connecting ? (
                        <span className="text-xs text-slate-400">Connexion…</span>
                      ) : (
                        <span className="text-amber-400">→</span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              onClick={closeWalletPicker}
              className="mt-4 w-full rounded-lg border border-slate-600 py-2 text-sm font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}

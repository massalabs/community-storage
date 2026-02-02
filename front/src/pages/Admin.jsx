import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../context/WalletContext'
import {
  getContractAddress,
  getContractBalance,
  isSandboxMode,
} from '../contract/storageRegistryApi'
import { StatCard } from '../components/StatCard'

const ADMIN_ADDRESS = (import.meta.env.VITE_ADMIN_ADDRESS || 'AU12KpB8wn2Sr3tE3TbtUZ4V1ouGjRmVcmcb6FqfgkM1kUZZPaWLV').trim()

function toNum(v) {
  return typeof v === 'bigint' ? Number(v) : v
}

function formatNanoMas(nano) {
  const n = toNum(nano)
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR')} MAS`
  return `${n.toLocaleString('fr-FR')} nanoMAS`
}

export function Admin() {
  const { address, connected, account } = useWallet()
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositing, setDepositing] = useState(false)
  const [depositError, setDepositError] = useState(null)
  const [depositSuccess, setDepositSuccess] = useState(false)

  const isAdmin = !!ADMIN_ADDRESS && connected && (address?.toLowerCase() === ADMIN_ADDRESS?.toLowerCase())

  const fetchBalance = useCallback(async () => {
    setLoading(true)
    try {
      const bal = await getContractBalance(true)
      setBalance(bal)
    } catch (e) {
      setBalance(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    fetchBalance()
  }, [isAdmin, fetchBalance])

  const sandbox = isSandboxMode()

  async function handleDeposit(e) {
    e.preventDefault()
    if (sandbox || !account || !depositAmount) return
    const mas = parseFloat(depositAmount.replace(',', '.'))
    if (!Number.isFinite(mas) || mas <= 0) {
      setDepositError('Montant invalide.')
      return
    }
    setDepositing(true)
    setDepositError(null)
    setDepositSuccess(false)
    try {
      const nano = BigInt(Math.floor(mas * 1e9))
      await account.transfer(getContractAddress(), nano)
      setDepositSuccess(true)
      setDepositAmount('')
      await fetchBalance()
    } catch (e) {
      setDepositError(e?.message ?? 'Erreur lors du dépôt.')
    } finally {
      setDepositing(false)
    }
  }

  // Non-admin ou non connecté : afficher comme si la page n'existait pas (404)
  if (!connected || !address || !isAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <p className="font-mono text-6xl font-bold text-slate-600">404</p>
        <h1 className="mt-4 text-xl font-semibold text-slate-300">Page introuvable</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Cette page n'existe pas ou a été déplacée.
        </p>
        <a
          href="/"
          className="mt-8 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
        >
          Retour à l'accueil
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin</h1>
        <p className="mt-1 text-slate-400">
          Balance du contrat et dépôt de MAS pour les récompenses.
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Balance du contrat</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="MAS déposés sur le contrat"
            value={loading ? '…' : formatNanoMas(balance ?? 0n)}
            subtext="Balance finale (récompenses disponibles)"
          />
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
            <p className="text-sm font-medium text-slate-400">Adresse du contrat</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-300" title={getContractAddress()}>
              {getContractAddress()}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchBalance}
          disabled={loading}
          className="mt-3 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          Rafraîchir
        </button>
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-200">Déposer des MAS</h2>
        {sandbox && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Bac à sable : les dépôts sont désactivés pour éviter tout envoi réel sur le contrat.
          </div>
        )}
        <form onSubmit={handleDeposit} className="max-w-md space-y-4">
          <div>
            <label htmlFor="deposit-amount" className="block text-sm font-medium text-slate-400">
              Montant (MAS)
            </label>
            <input
              id="deposit-amount"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              disabled={sandbox}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 font-mono text-white placeholder-slate-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50 disabled:opacity-60"
            />
          </div>
          {depositError && (
            <p className="text-sm text-red-400">{depositError}</p>
          )}
          {depositSuccess && (
            <p className="text-sm text-green-400">Dépôt envoyé avec succès.</p>
          )}
          <button
            type="submit"
            disabled={sandbox || depositing || !depositAmount}
            className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
          >
            {depositing ? 'Envoi…' : 'Déposer sur le contrat'}
          </button>
        </form>
      </section>
    </div>
  )
}

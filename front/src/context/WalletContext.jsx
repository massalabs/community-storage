import { createContext, useCallback, useContext, useState, useEffect } from 'react'
import { getWallets } from '@massalabs/wallet-provider'

const WalletContext = createContext(null)

const STORAGE_KEY = 'massa-storage-wallet'

function getStoredWallet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data?.walletName && data?.address) return data
    return null
  } catch {
    return null
  }
}

function setStoredWallet(walletName, address) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ walletName, address }))
  } catch {}
}

function clearStoredWallet() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}

/** Labels pour les noms de wallet (WalletName) */
const WALLET_LABELS = {
  'MASSA WALLET': 'Massa Station',
  BEARBY: 'Bearby',
  METAMASK: 'Metamask',
}

export function getWalletLabel(wallet) {
  try {
    const name = wallet?.name?.() ?? ''
    return WALLET_LABELS[name] ?? name
  } catch {
    return 'Wallet'
  }
}

export function WalletProvider({ children }) {
  const [address, setAddress] = useState(null)
  const [account, setAccount] = useState(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [availableWallets, setAvailableWallets] = useState([])
  const [accountPickerOpen, setAccountPickerOpen] = useState(false)
  const [availableAccounts, setAvailableAccounts] = useState([])
  const [pendingWallet, setPendingWallet] = useState(null)

  /** Restauration de la connexion au chargement (localStorage) */
  useEffect(() => {
    let cancelled = false
    const stored = getStoredWallet()
    if (!stored?.walletName || !stored?.address) return
    async function restore() {
      try {
        const wallets = await getWallets()
        if (cancelled || !wallets?.length) return
        const walletName = stored.walletName.toUpperCase?.() ?? stored.walletName
        const w = wallets.find((x) => {
          try {
            const n = (x?.name?.() ?? '').toUpperCase?.() ?? ''
            return n === walletName || n.includes(walletName) || walletName.includes(n)
          } catch {
            return false
          }
        })
        if (!w || cancelled) return
        const ok = await w.connect()
        if (!ok || cancelled) return
        const accounts = await w.accounts()
        if (!accounts?.length || cancelled) return
        const addr = (stored.address || '').toLowerCase()
        const acc = accounts.find((a) => (a?.address ?? '').toLowerCase() === addr) ?? accounts[0]
        if (!cancelled) {
          setWallet(w)
          setAddress(acc?.address ?? stored.address)
          setAccount(acc)
          setConnected(true)
        }
      } catch (_) {
        if (!cancelled) clearStoredWallet()
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  const openWalletPicker = useCallback(async () => {
    setError(null)
    setWalletPickerOpen(true)
    setAvailableWallets([])
    try {
      const wallets = await getWallets()
      if (!wallets?.length) {
        setError('Aucun wallet détecté. Installez Massa Station ou Bearby.')
        setWalletPickerOpen(false)
        return
      }
      setAvailableWallets(wallets)
    } catch (e) {
      setError(e?.message ?? 'Erreur')
      setWalletPickerOpen(false)
    }
  }, [])

  const closeWalletPicker = useCallback(() => {
    setWalletPickerOpen(false)
    setAvailableWallets([])
  }, [])

  const closeAccountPicker = useCallback(() => {
    setAccountPickerOpen(false)
    setAvailableAccounts([])
    setPendingWallet(null)
    setConnecting(false)
  }, [])

  const openAccountPicker = useCallback(async () => {
    if (!wallet) return
    setError(null)
    try {
      const accounts = await wallet.accounts()
      if (!accounts?.length) return
      if (accounts.length === 1) return
      setPendingWallet(null)
      setAvailableAccounts(accounts)
      setAccountPickerOpen(true)
    } catch (e) {
      setError(e?.message ?? 'Erreur')
    }
  }, [wallet])

  const selectAccount = useCallback((acc) => {
    const addr = acc?.address ?? null
    if (!addr) return
    if (pendingWallet) {
      const walletName = (typeof pendingWallet?.name === 'function' ? pendingWallet.name() : '') ?? ''
      setStoredWallet(walletName, addr)
      setAddress(addr)
      setAccount(acc)
      setWallet(pendingWallet)
      setConnected(true)
      setAccountPickerOpen(false)
      setAvailableAccounts([])
      setPendingWallet(null)
      setWalletPickerOpen(false)
      setAvailableWallets([])
      setConnecting(false)
    } else if (wallet) {
      const walletName = (typeof wallet?.name === 'function' ? wallet.name() : '') ?? ''
      setStoredWallet(walletName, addr)
      setAddress(addr)
      setAccount(acc)
      setAccountPickerOpen(false)
      setAvailableAccounts([])
    }
  }, [pendingWallet, wallet])

  const connectWith = useCallback(async (w) => {
    setConnecting(true)
    setError(null)
    try {
      const ok = await w.connect()
      if (!ok) {
        setError('Connexion refusée.')
        setConnecting(false)
        return
      }
      const accounts = await w.accounts()
      if (!accounts?.length) {
        setError('Aucun compte dans le wallet.')
        if (w.disconnect) await w.disconnect()
        setConnecting(false)
        return
      }
      if (accounts.length === 1) {
        const acc = accounts[0]
        const walletName = (typeof w?.name === 'function' ? w.name() : '') ?? ''
        setStoredWallet(walletName, acc?.address ?? '')
        setWallet(w)
        setAddress(acc.address)
        setAccount(acc)
        setConnected(true)
        setWalletPickerOpen(false)
        setAvailableWallets([])
        setConnecting(false)
      } else {
        setWalletPickerOpen(false)
        setAvailableWallets([])
        setPendingWallet(w)
        setAvailableAccounts(accounts)
        setAccountPickerOpen(true)
      }
    } catch (e) {
      setError(e?.message ?? 'Erreur de connexion')
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setError(null)
    clearStoredWallet()
    try {
      if (wallet?.disconnect) await wallet.disconnect()
    } catch (_) {}
    setWallet(null)
    setAddress(null)
    setAccount(null)
    setConnected(false)
  }, [wallet])

  const value = {
    address,
    account,
    connected,
    connecting,
    error,
    openWalletPicker,
    closeWalletPicker,
    connectWith,
    disconnect,
    wallet,
    walletPickerOpen,
    availableWallets,
    getWalletLabel,
    accountPickerOpen,
    availableAccounts,
    selectAccount,
    closeAccountPicker,
    openAccountPicker,
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

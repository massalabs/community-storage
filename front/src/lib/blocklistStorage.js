/**
 * Blocklist des adresses de providers à exclure (localStorage), par wallet.
 * Clé : massa-storage-blocklist-${walletAddress.toLowerCase()}
 * Valeur : JSON array de strings (adresses, une par entrée).
 */

const STORAGE_KEY_PREFIX = 'massa-storage-blocklist-'

function storageKey(walletAddress) {
  return STORAGE_KEY_PREFIX + (walletAddress || '').toLowerCase()
}

function parseAddresses(raw) {
  if (typeof raw !== 'string') return []
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Retourne la liste des adresses bloquées pour ce wallet (tableau de strings). */
export function getBlocklist(walletAddress) {
  try {
    const raw = localStorage.getItem(storageKey(walletAddress))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((a) => typeof a === 'string' && a.length > 0) : []
  } catch {
    return []
  }
}

/** Enregistre la blocklist pour ce wallet (tableau d'adresses ou string avec une adresse par ligne). */
export function setBlocklist(walletAddress, addresses) {
  const key = storageKey(walletAddress)
  const list = Array.isArray(addresses)
    ? addresses.map((a) => String(a).trim()).filter(Boolean)
    : parseAddresses(addresses)
  localStorage.setItem(key, JSON.stringify(list))
  return list
}

/** Retourne un Set des adresses bloquées en minuscules pour ce wallet. */
export function getBlocklistSet(walletAddress) {
  const list = getBlocklist(walletAddress)
  return new Set(list.map((a) => a.toLowerCase()))
}


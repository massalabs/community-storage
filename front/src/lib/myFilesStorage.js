/**
 * Stockage local des fichiers hébergés, par adresse wallet (uploader).
 * Clé localStorage : massa-storage-my-files-${address}
 * Format : tableau de { id, name, size, replicationCount, durationMonths, providers[], uploadedAt, expiresAt, uploaderAddress?, ... }
 */

const STORAGE_KEY_PREFIX = 'massa-storage-my-files'

function storageKey(walletAddress) {
  if (!walletAddress || typeof walletAddress !== 'string') return null
  return `${STORAGE_KEY_PREFIX}-${walletAddress.trim().toLowerCase()}`
}

/** Liste des fichiers hébergés pour cette adresse. Retourne [] si pas d'adresse. */
export function getStoredFiles(walletAddress) {
  const key = storageKey(walletAddress)
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function addStoredFiles(walletAddress, entries) {
  const key = storageKey(walletAddress)
  if (!key) return []
  const list = getStoredFiles(walletAddress)
  const next = [...list, ...entries]
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

export function updateStoredFile(walletAddress, id, updates) {
  const list = getStoredFiles(walletAddress)
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return list
  const key = storageKey(walletAddress)
  if (!key) return list
  const next = [...list]
  next[idx] = { ...next[idx], ...updates }
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

/** Prolonge l'expiration d'un fichier (ou plusieurs) de N mois. */
export function extendStoredFiles(walletAddress, ids, monthsToAdd) {
  const key = storageKey(walletAddress)
  if (!key) return []
  const list = getStoredFiles(walletAddress)
  const next = list.map((e) => {
    if (!ids.includes(e.id)) return e
    const exp = new Date(e.expiresAt)
    exp.setMonth(exp.getMonth() + monthsToAdd)
    return { ...e, expiresAt: exp.toISOString() }
  })
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

export function removeStoredFile(walletAddress, id) {
  const key = storageKey(walletAddress)
  if (!key) return []
  const list = getStoredFiles(walletAddress).filter((e) => e.id !== id)
  localStorage.setItem(key, JSON.stringify(list))
  return list
}

/** Supprime plusieurs fichiers par id. */
export function removeStoredFiles(walletAddress, ids) {
  const key = storageKey(walletAddress)
  if (!key) return []
  const idSet = new Set(ids)
  const list = getStoredFiles(walletAddress).filter((e) => !idSet.has(e.id))
  localStorage.setItem(key, JSON.stringify(list))
  return list
}

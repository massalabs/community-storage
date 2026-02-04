/**
 * Stockage local des fichiers hébergés (simulation sans backend).
 * Clé localStorage : massa-storage-my-files
 * Format : tableau de { id, name, size, replicationCount, durationMonths, providers[], uploadedAt, expiresAt }
 */

const STORAGE_KEY = 'massa-storage-my-files'

export function getStoredFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function addStoredFiles(entries) {
  const list = getStoredFiles()
  const next = [...list, ...entries]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function updateStoredFile(id, updates) {
  const list = getStoredFiles()
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return list
  const next = [...list]
  next[idx] = { ...next[idx], ...updates }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

/** Prolonge l’expiration d’un fichier (ou plusieurs) de N mois. */
export function extendStoredFiles(ids, monthsToAdd) {
  const list = getStoredFiles()
  const next = list.map((e) => {
    if (!ids.includes(e.id)) return e
    const exp = new Date(e.expiresAt)
    exp.setMonth(exp.getMonth() + monthsToAdd)
    return { ...e, expiresAt: exp.toISOString() }
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function removeStoredFile(id) {
  const list = getStoredFiles().filter((e) => e.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  return list
}

/** Supprime plusieurs fichiers par id. */
export function removeStoredFiles(ids) {
  const idSet = new Set(ids)
  const list = getStoredFiles().filter((e) => !idSet.has(e.id))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  return list
}

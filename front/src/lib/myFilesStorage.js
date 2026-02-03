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

/** Fichiers de démo pour le bac à sable (quand la liste réelle est vide). */
const MOCK_PROVIDER_ADDRESSES = [
  'AU12Provider1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'AU12Provider2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'AU12Provider3cccccccccccccccccccccccccccccccccccccccc',
]

function makeExpires(monthsFromNow) {
  const d = new Date()
  d.setMonth(d.getMonth() + monthsFromNow)
  return d.toISOString()
}

function makeUploaded(monthsAgo) {
  const d = new Date()
  d.setMonth(d.getMonth() - monthsAgo)
  return d.toISOString()
}

export function getSandboxMockFiles() {
  return [
    { id: 'sandbox-1', name: 'rapport-2024.pdf', size: 2_400_000, replicationCount: 2, durationMonths: 12, providers: [MOCK_PROVIDER_ADDRESSES[0], MOCK_PROVIDER_ADDRESSES[1]], uploadedAt: makeUploaded(2), expiresAt: makeExpires(10) },
    { id: 'sandbox-2', name: 'backup-db.sql.gz', size: 156_000_000, replicationCount: 3, durationMonths: 6, providers: MOCK_PROVIDER_ADDRESSES.slice(), uploadedAt: makeUploaded(1), expiresAt: makeExpires(5) },
    { id: 'sandbox-3', name: 'presentation.odp', size: 8_500_000, replicationCount: 1, durationMonths: 3, providers: [MOCK_PROVIDER_ADDRESSES[2]], uploadedAt: makeUploaded(0), expiresAt: makeExpires(3) },
    { id: 'sandbox-4', name: 'medias-archive.zip', size: 1_200_000_000, replicationCount: 2, durationMonths: 12, providers: [MOCK_PROVIDER_ADDRESSES[0], MOCK_PROVIDER_ADDRESSES[2]], uploadedAt: makeUploaded(4), expiresAt: makeExpires(8) },
    { id: 'sandbox-5', name: 'config.env.example', size: 1024, replicationCount: 1, durationMonths: 1, providers: [MOCK_PROVIDER_ADDRESSES[1]], uploadedAt: makeUploaded(2), expiresAt: makeExpires(-1) }, // expiré
  ]
}

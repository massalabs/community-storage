/**
 * Récupère un fichier hébergé chez un provider (massa-storage-server).
 * API supposée : GET {baseUrl}/download?namespace=community&id={storageId}
 * Retourne le contenu binaire du fichier pour déclencher le téléchargement côté client.
 *
 * @param {string} baseUrl - URL de base du provider (ex. https://storage1.massa.net)
 * @param {string} storageId - Id du fichier (même que pour l'upload : namespace=community, id=storageId)
 * @returns {Promise<{ ok: true, blob: Blob } | { ok: false, error: string }>}
 */
export async function downloadFileFromProvider(baseUrl, storageId) {
  const url = new URL('/download', baseUrl.replace(/\/$/, ''))
  url.searchParams.set('namespace', 'community')
  url.searchParams.set('id', storageId)

  try {
    const res = await fetch(url.toString(), { method: 'GET' })

    if (!res.ok) {
      const text = await res.text()
      let err = `HTTP ${res.status}`
      try {
        const json = JSON.parse(text)
        if (json.error) err = json.error
      } catch (_) {}
      return { ok: false, error: err }
    }

    const blob = await res.blob()
    return { ok: true, blob }
  } catch (e) {
    return { ok: false, error: e?.message || 'Erreur réseau' }
  }
}

/**
 * Télécharge un fichier depuis le premier provider disponible (uploadedTo).
 * Déclenche le téléchargement dans le navigateur (nom de fichier = fileName).
 *
 * @param {string[]} baseUrls - URLs de base des providers où le fichier est hébergé
 * @param {string} storageId - Id du fichier
 * @param {string} fileName - Nom du fichier pour l'enregistrement
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function downloadAndSaveFromProvider(baseUrls, storageId, fileName) {
  if (!baseUrls?.length) {
    return { ok: false, error: 'Aucun provider connu pour ce fichier.' }
  }

  for (const baseUrl of baseUrls) {
    const result = await downloadFileFromProvider(baseUrl, storageId)
    if (!result.ok) continue
    const blob = result.blob
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'fichier'
    a.click()
    URL.revokeObjectURL(url)
    return { ok: true }
  }

  return { ok: false, error: 'Impossible de récupérer le fichier depuis les providers.' }
}

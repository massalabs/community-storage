/**
 * Envoie un fichier vers un provider (massa-storage-server).
 * API : POST {baseUrl}/upload?namespace=community&id={id}
 * Body : binaire brut du fichier.
 *
 * @param {string} baseUrl - URL de base du provider (ex. https://storage1.massa.net)
 * @param {File} file - Fichier à envoyer
 * @param {string} storageId - Id unique pour ce fichier (namespace=community, id=storageId)
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function uploadFileToProvider(baseUrl, file, storageId) {
  const url = new URL('/upload', baseUrl.replace(/\/$/, ''))
  url.searchParams.set('namespace', 'community')
  url.searchParams.set('id', storageId)

  try {
    const body = await file.arrayBuffer()
    const res = await fetch(url.toString(), {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    })

    if (!res.ok) {
      const text = await res.text()
      let err = `HTTP ${res.status}`
      try {
        const json = JSON.parse(text)
        if (json.error) err = json.error
      } catch (_) {}
      return { ok: false, error: err }
    }

    const data = await res.json().catch(() => ({}))
    return { ok: true, id: data.id || storageId }
  } catch (e) {
    return { ok: false, error: e?.message || 'Erreur réseau' }
  }
}

/**
 * Envoie un fichier vers plusieurs endpoints (réplication).
 * @param {string[]} endpoints - URLs de base des providers
 * @param {File} file - Fichier à envoyer
 * @param {string} storageId - Id unique
 * @returns {Promise<{ succeeded: string[], failed: { url: string, error: string }[] }>}
 */
export async function uploadFileToProviders(endpoints, file, storageId) {
  if (!endpoints.length) return { succeeded: [], failed: [] }

  const results = await Promise.all(
    endpoints.map(async (baseUrl) => {
      const r = await uploadFileToProvider(baseUrl, file, storageId)
      return { baseUrl, ...r }
    })
  )

  const succeeded = results.filter((r) => r.ok).map((r) => r.baseUrl)
  const failed = results.filter((r) => !r.ok).map((r) => ({ url: r.baseUrl, error: r.error }))

  return { succeeded, failed }
}

import { blake3 } from '@noble/hashes/blake3'

/** Encode bytes en hex (64 caractères pour 32 octets). */
function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Envoie un fichier vers un provider (massa-storage-server).
 * API : POST {baseUrl}/upload?namespace=community&id={id}
 * Body : binaire brut du fichier.
 * Si signer est fourni, ajoute X-Massa-Address, X-Massa-Signature, X-Massa-Public-Key (le serveur vérifie getIsAllowedUploader).
 * Mode wallet : on fait signer hex(Blake3(body)) par le wallet ; le serveur vérifie Blake3(utf8(hex(Blake3(body)))).
 *
 * @param {string} baseUrl - URL de base du provider
 * @param {File} file - Fichier à envoyer
 * @param {string} storageId - Id unique (namespace=community, id=storageId)
 * @param {{ address: string, sign: (data: Uint8Array|string) => Promise<string|{ signature: string, publicKey?: string }>, publicKey?: string }} [signer] - Optionnel : adresse + sign. sign() reçoit hex(Blake3(body)) (string) pour les wallets.
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
export async function uploadFileToProvider(baseUrl, file, storageId, signer = null) {
  const url = new URL('/upload', baseUrl.replace(/\/$/, ''))
  url.searchParams.set('namespace', 'community')
  url.searchParams.set('id', storageId)

  try {
    const body = await file.arrayBuffer()
    const bodyBytes = new Uint8Array(body)
    const headers = {
      'Content-Type': 'application/octet-stream',
    }
    if (signer && typeof signer.sign === 'function' && signer.address) {
      // Les wallets signent une chaîne (UTF-8). On fait signer hex(Blake3(body)) pour éviter la corruption du binaire.
      const bodyHash = blake3(bodyBytes)
      const hashHex = bytesToHex(bodyHash)
      const signResult = await signer.sign(hashHex)
      const sigStr =
        typeof signResult === 'string'
          ? signResult
          : signResult && typeof signResult.toString === 'function'
            ? signResult.toString()
            : (signResult?.signature ?? String(signResult))
      // Clé publique : d'abord depuis le résultat de sign() (SignedData du wallet), sinon signer.publicKey
      const pkFromResult =
        signResult && typeof signResult === 'object' && signResult.publicKey != null
          ? typeof signResult.publicKey === 'string'
            ? signResult.publicKey
            : typeof signResult.publicKey?.toString === 'function'
              ? signResult.publicKey.toString()
              : String(signResult.publicKey)
          : ''
      const pkRaw = pkFromResult || signer.publicKey
      const pkStr =
        pkRaw == null || pkRaw === ''
          ? ''
          : typeof pkRaw === 'string'
            ? pkRaw
            : typeof pkRaw?.toString === 'function'
              ? pkRaw.toString()
              : String(pkRaw)
      headers['X-Massa-Address'] = typeof signer.address === 'string' ? signer.address.trim() : String(signer.address)
      headers['X-Massa-Signature'] = sigStr
      if (pkStr) headers['X-Massa-Public-Key'] = pkStr
    }
    const res = await fetch(url.toString(), {
      method: 'POST',
      body,
      headers,
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
 * @param {{ address: string, sign: (data: Uint8Array) => Promise<string|{ signature, publicKey? }>, publicKey?: string }} [signer] - Optionnel pour signature (auth upload)
 * @returns {Promise<{ succeeded: string[], failed: { url: string, error: string }[] }>}
 */
export async function uploadFileToProviders(endpoints, file, storageId, signer = null) {
  if (!endpoints.length) return { succeeded: [], failed: [] }

  const results = await Promise.all(
    endpoints.map(async (baseUrl) => {
      const r = await uploadFileToProvider(baseUrl, file, storageId, signer)
      return { baseUrl, ...r }
    })
  )

  const succeeded = results.filter((r) => r.ok).map((r) => r.baseUrl)
  const failed = results.filter((r) => !r.ok).map((r) => ({ url: r.baseUrl, error: r.error }))

  return { succeeded, failed }
}

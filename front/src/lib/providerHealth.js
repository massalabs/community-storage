/**
 * Vérifie si un provider (endpoint HTTP) est joignable (up/down).
 * Un seul GET ( /health ou / ) avec timeout court pour rester rapide.
 * Note : si le serveur ne renvoie pas de CORS, le navigateur bloquera et on considérera "down".
 *
 * @param {string} baseUrl - URL de base du provider (ex. https://storage1.massa.net)
 * @returns {Promise<'up'|'down'>}
 */
const CHECK_TIMEOUT_MS = 1200

export async function checkProviderUp(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return 'down'
  const url = baseUrl.replace(/\/$/, '')
  const target = `${url}/`
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    const res = await fetch(target, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (res.ok || (res.status >= 400 && res.status < 600)) return 'up'
  } catch (_) {}
  return 'down'
}

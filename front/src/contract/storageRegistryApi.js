/**
 * Point d'entrée unique pour les données du contrat.
 * Mode bac à sable : (1) VITE_SANDBOX=true au build, ou (2) en dev, choix "Bac à sable" dans l'UI (localStorage).
 * Sinon : appels réels au smart contract buildnet.
 */
import * as mock from './mockData.js'
import * as real from './storageRegistry.js'

const STORAGE_KEY = 'massa-storage-sandbox'

/** True si on utilise les données fictives (build sandbox OU choix utilisateur en dev). */
function getSandbox() {
  if (import.meta.env.VITE_SANDBOX === 'true') return true
  if (typeof localStorage === 'undefined') return false
  if (!import.meta.env.DEV) return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

function api() {
  return getSandbox() ? mock : real
}

export function getContractAddress() {
  return api().CONTRACT_ADDRESS
}

export async function getCurrentPeriod() {
  return api().getCurrentPeriod()
}

export async function getConfig() {
  return api().getConfig()
}

export async function getTotalNodes() {
  return api().getTotalNodes()
}

export async function getPeriodStats(period) {
  return api().getPeriodStats(period)
}

export async function getNodeInfo(address) {
  return api().getNodeInfo(address)
}

export async function calculatePendingRewards(address) {
  return api().calculatePendingRewards(address)
}

export async function getContractBalance(final = true) {
  return api().getContractBalance(final)
}

/** Liste des providers de stockage avec place dispo et métadonnées (endpoint, p2pAddrs). */
export async function getStorageProviders() {
  return api().getStorageProviders()
}

/** Métadonnées d'un provider (endpoint HTTP + P2P) pour hébergement. */
export async function getProviderMetadata(address) {
  return api().getProviderMetadata(address)
}

/** True si l'app tourne en mode bac à sable (données fictives). */
export function isSandboxMode() {
  return getSandbox()
}

/** Bascule le mode en dev (localStorage) puis recharge. No-op si build sandbox ou production. */
export function setSandboxMode(sandbox) {
  if (import.meta.env.VITE_SANDBOX === 'true') return
  if (!import.meta.env.DEV) return
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, sandbox ? 'true' : 'false')
  window.location.reload()
}

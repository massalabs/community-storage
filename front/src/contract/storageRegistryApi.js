/**
 * Point d'entrée unique pour les données du contrat (buildnet).
 */
import * as real from './storageRegistry.js'

export function getContractAddress() {
  return real.CONTRACT_ADDRESS
}

export async function getCurrentPeriod() {
  return real.getCurrentPeriod()
}

export async function getConfig() {
  return real.getConfig()
}

export async function getTotalNodes() {
  return real.getTotalNodes()
}

export async function getPeriodStats(period) {
  return real.getPeriodStats(period)
}

export async function getNodeInfo(address) {
  return real.getNodeInfo(address)
}

export async function calculatePendingRewards(address) {
  return real.calculatePendingRewards(address)
}

export async function getContractBalance(final = true) {
  return real.getContractBalance(final)
}

/** Liste des providers de stockage avec place dispo et métadonnées (endpoint, p2pAddrs). */
export async function getStorageProviders() {
  return real.getStorageProviders()
}

/** Métadonnées d'un provider (endpoint HTTP + P2P) pour hébergement. */
export async function getProviderMetadata(address) {
  return real.getProviderMetadata(address)
}

/**
 * Point d'entrée unique pour les données du contrat (buildnet).
 */
import { Args } from '@massalabs/massa-web3'
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

/** Vérifie si une adresse peut uploader (admin ou a réservé du stockage). */
export async function getIsAllowedUploader(address) {
  return real.getIsAllowedUploader(address)
}

/** GB réservés par une adresse (registerAsUploader). */
export async function getBookedUploaderGb(address) {
  return real.getBookedUploaderGb(address)
}

/** Usage global du stockage (capacité totale, réservée, disponible). */
export async function getGlobalStorageUsage() {
  return real.getGlobalStorageUsage()
}

/** Prix nanoMAS par GB pour réserver en tant qu'uploader. */
export async function getUploaderPricePerGb() {
  return real.getUploaderPricePerGb()
}

/**
 * Enregistre l'appelant comme uploader en réservant amountGb (paiement au contrat).
 * Appelle registerAsUploader(amountGb) avec transfert de amountGb * uploaderPricePerGb.
 * @param {object} account - Compte wallet (doit avoir callSC avec option coins)
 * @param {bigint} amountGb - Nombre de GB à réserver
 */
export async function registerAsUploaderWithTransfer(account, amountGb) {
  const pricePerGb = await real.getUploaderPricePerGb()
  const requiredNano = amountGb * pricePerGb
  if (requiredNano <= 0n) throw new Error('Prix uploader inconnu')
  if (typeof account.callSC !== 'function') {
    throw new Error('Ce wallet ne supporte pas l\'appel au contrat avec paiement.')
  }
  const param = new Args().addU64(amountGb).serialize()
  const op = await account.callSC({
    func: 'registerAsUploader',
    target: real.CONTRACT_ADDRESS,
    parameter: param,
    coins: requiredNano,
  })
  if (op && typeof op.waitFinalExecution === 'function') {
    await op.waitFinalExecution()
  }
}

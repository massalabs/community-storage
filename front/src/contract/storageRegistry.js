/**
 * Client de lecture du smart contract Storage Registry (buildnet).
 * Utilise JsonRpcPublicProvider pour les appels read-only sans wallet.
 */
import {
  Args,
  JsonRpcPublicProvider,
  PublicAPI,
  PublicApiUrl,
  SmartContract,
} from '@massalabs/massa-web3'

const CONTRACT_ADDRESS =
  import.meta.env.VITE_STORAGE_REGISTRY_ADDRESS ||
  'AS1V8vQxhL1q2c6fZJ8pGhU51eZiSLSNAwRojbmvVKWDaKbnsHk6'

let provider = null
let contract = null
let publicApi = null

function getContract() {
  if (!contract) {
    provider = JsonRpcPublicProvider.buildnet()
    contract = new SmartContract(provider, CONTRACT_ADDRESS)
  }
  return contract
}

/**
 * Période courante sur la chaîne (buildnet).
 * @returns {Promise<number>}
 */
export async function getCurrentPeriod() {
  if (!publicApi) publicApi = new PublicAPI(PublicApiUrl.Buildnet)
  return publicApi.fetchPeriod()
}

/**
 * Lit la configuration du contrat (StorageConfig).
 * @returns {Promise<{ rewardPerGbPerPeriod, minAllocatedGb, maxAllocatedGb, challengeResponseTimeout, slashPercentage, minStake, rewardDistributionPeriod }>}
 */
export async function getConfig() {
  const sc = getContract()
  const res = await sc.read('getConfigView', new Args())
  if (res.info?.error) throw new Error(res.info.error)
  const args = new Args(res.value)
  return {
    rewardPerGbPerPeriod: args.nextU64(),
    minAllocatedGb: args.nextU64(),
    maxAllocatedGb: args.nextU64(),
    challengeResponseTimeout: args.nextU64(),
    slashPercentage: args.nextU64(),
    minStake: args.nextU64(),
    rewardDistributionPeriod: args.nextU64(),
  }
}

/**
 * Lit le nombre total de nœuds enregistrés.
 * @returns {Promise<bigint>}
 */
export async function getTotalNodes() {
  const sc = getContract()
  const res = await sc.read('getTotalNodesCount', new Args())
  if (res.info?.error) throw new Error(res.info.error)
  const args = new Args(res.value)
  return args.nextU64()
}

/**
 * Lit les stats d'une période (PeriodStats).
 * @param {number|bigint} period - Numéro de période
 * @returns {Promise<{ period, totalGbStored, totalRewardsDistributed, activeNodes, challengesIssued, challengesPassed, rewardsDistributed }>}
 */
export async function getPeriodStats(period) {
  const sc = getContract()
  const args = new Args().addU64(BigInt(period))
  const res = await sc.read('getPeriodStatsView', args)
  if (res.info?.error) throw new Error(res.info.error)
  const out = new Args(res.value)
  return {
    period: out.nextU64(),
    totalGbStored: out.nextU64(),
    totalRewardsDistributed: out.nextU64(),
    activeNodes: out.nextU64(),
    challengesIssued: out.nextU64(),
    challengesPassed: out.nextU64(),
    rewardsDistributed: out.nextBool(),
  }
}

/**
 * Lit les infos d'un nœud de stockage (StorageNode).
 * @param {string} address - Adresse du nœud
 * @returns {Promise<{ address, allocatedGb, registeredPeriod, totalChallenges, passedChallenges, pendingRewards, lastChallengedPeriod, stakedAmount, active } | null>} null si non enregistré
 */
export async function getNodeInfo(address) {
  const sc = getContract()
  const args = new Args().addString(address)
  const res = await sc.read('getNodeInfo', args)
  if (res.info?.error) return null
  const out = new Args(res.value)
  return {
    address: out.nextString(),
    allocatedGb: out.nextU64(),
    registeredPeriod: out.nextU64(),
    totalChallenges: out.nextU64(),
    passedChallenges: out.nextU64(),
    pendingRewards: out.nextU64(),
    lastChallengedPeriod: out.nextU64(),
    stakedAmount: out.nextU64(),
    active: out.nextBool(),
  }
}

/**
 * Récompenses en attente pour une adresse (nanoMAS).
 * @param {string} address
 * @returns {Promise<bigint>}
 */
export async function calculatePendingRewards(address) {
  const sc = getContract()
  const args = new Args().addString(address)
  const res = await sc.read('calculatePendingRewards', args)
  if (res.info?.error) throw new Error(res.info.error)
  const out = new Args(res.value)
  return out.nextU64()
}

/**
 * Balance du contrat (nanoMAS). Pour l’admin : MAS déposés sur le contrat.
 * @param {boolean} [final=true]
 * @returns {Promise<bigint>}
 */
export async function getContractBalance(final = true) {
  const sc = getContract()
  return sc.balance(final)
}

/**
 * Lit l'adresse d'un nœud par index (pour lister les providers).
 * @param {number|bigint} index - Index (0 à totalNodes - 1)
 * @returns {Promise<string>} Adresse ou '' si hors limites
 */
export async function getNodeAddressAt(index) {
  const sc = getContract()
  const args = new Args().addU64(BigInt(index))
  const res = await sc.read('getNodeAddressAt', args)
  if (res.info?.error) return ''
  const out = new Args(res.value)
  return out.nextString() || ''
}

/**
 * Liste des providers avec place dispo (version réelle : lit la liste on-chain).
 * Chaque item : { address, allocatedGb, usedGb?, availableGb }. usedGb non exposé par le contrat → availableGb = allocatedGb.
 * @returns {Promise<Array<{ address, allocatedGb, usedGb?, availableGb }>>}
 */
export async function getStorageProviders() {
  const total = await getTotalNodes()
  const n = Number(total)
  if (n === 0) return []
  const list = []
  for (let i = 0; i < n; i++) {
    const address = await getNodeAddressAt(i)
    if (!address) continue
    const info = await getNodeInfo(address)
    if (!info || !info.active) continue
    const allocatedGb = info.allocatedGb
    const usedGb = info.usedGb != null ? info.usedGb : 0n
    const availableGb = allocatedGb - usedGb
    list.push({ address, allocatedGb, usedGb, availableGb: availableGb > 0n ? availableGb : allocatedGb })
  }
  return list
}

export { CONTRACT_ADDRESS }

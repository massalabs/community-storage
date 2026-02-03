/**
 * Données fictives pour le mode bac à sable (VITE_SANDBOX=true).
 * Même interface que storageRegistry.js, aucune requête réseau.
 */

const MOCK_CONTRACT_ADDRESS = 'AS1Sandbox0000000000000000000000000000000000000000000'

// Config réaliste pour tests UI
const MOCK_CONFIG = {
  rewardPerGbPerPeriod: BigInt(5e8),       // 0.5 MAS/GB/période
  minAllocatedGb: 1n,
  maxAllocatedGb: 1000n,
  challengeResponseTimeout: 60_000n,       // 60 s
  slashPercentage: 5n,
  minStake: BigInt(100 * 1e9),            // 100 MAS
  rewardDistributionPeriod: 100n,
}

const MOCK_TOTAL_NODES = 42n
const MOCK_CURRENT_PERIOD = 125_000
const MOCK_PERIOD_STATS = {
  period: BigInt(125_000),
  totalGbStored: 380n,
  totalRewardsDistributed: BigInt(2500 * 1e9),  // 2500 MAS
  activeNodes: 38n,
  challengesIssued: 120n,
  challengesPassed: 115n,
  rewardsDistributed: true,
}

function mockNodeInfo(address) {
  return {
    address,
    allocatedGb: 10n,
    usedGb: 3n,  // simulé : 3 GB utilisés sur 10
    registeredPeriod: BigInt(124_500),
    totalChallenges: 8n,
    passedChallenges: 8n,
    pendingRewards: BigInt(12.5 * 1e9),   // 12.5 MAS
    lastChallengedPeriod: BigInt(124_990),
    stakedAmount: BigInt(500 * 1e9),      // 500 MAS
    active: true,
  }
}

export const CONTRACT_ADDRESS = MOCK_CONTRACT_ADDRESS

export async function getCurrentPeriod() {
  return MOCK_CURRENT_PERIOD
}

export async function getConfig() {
  return { ...MOCK_CONFIG }
}

export async function getTotalNodes() {
  return MOCK_TOTAL_NODES
}

export async function getPeriodStats(_period) {
  return { ...MOCK_PERIOD_STATS }
}

export async function getNodeInfo(address) {
  if (!address) return null
  return mockNodeInfo(address)
}

export async function calculatePendingRewards(address) {
  if (!address) return 0n
  return BigInt(12.5 * 1e9)
}

export async function getContractBalance(_final = true) {
  return BigInt(50_000 * 1e9)  // 50 000 MAS
}

/** Liste des providers avec place dispo et métadonnées (pour Store Files). */
const MOCK_PROVIDERS = [
  { address: 'AU12Provider1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', allocatedGb: 100n, usedGb: 25n, availableGb: 75n, endpoint: 'https://storage1.demo.massa.net', p2pAddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWProvider1'] },
  { address: 'AU12Provider2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', allocatedGb: 50n, usedGb: 10n, availableGb: 40n, endpoint: 'https://storage2.demo.massa.net', p2pAddrs: [] },
  { address: 'AU12Provider3cccccccccccccccccccccccccccccccccccccccc', allocatedGb: 200n, usedGb: 120n, availableGb: 80n, endpoint: '', p2pAddrs: ['/ip4/10.0.0.3/tcp/4001/p2p/12D3KooWProvider3'] },
  { address: 'AU12Provider4dddddddddddddddddddddddddddddddddddddddd', allocatedGb: 20n, usedGb: 5n, availableGb: 15n, endpoint: 'https://storage4.demo.massa.net', p2pAddrs: [] },
  { address: 'AU12Provider5eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', allocatedGb: 500n, usedGb: 200n, availableGb: 300n, endpoint: '', p2pAddrs: [] },
]

export async function getStorageProviders() {
  return MOCK_PROVIDERS.map((p) => ({ ...p }))
}

/** Métadonnées mock (cohérent avec les providers ci-dessus). */
export async function getProviderMetadata(address) {
  const p = MOCK_PROVIDERS.find((x) => x.address === address)
  if (!p) return { endpoint: '', p2pAddrs: [] }
  return { endpoint: p.endpoint || '', p2pAddrs: p.p2pAddrs || [] }
}

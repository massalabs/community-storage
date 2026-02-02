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

/**
 * Storage Registry Smart Contract
 *
 * Manages storage provider registration, challenges, and reward distribution
 * for the Massa distributed storage layer.
 *
 * - No staking required - rewards are distributed only to providers who pass
 *   their data availability challenges.
 * - Allowed uploaders: (1) Storage admins (admin-added via addStorageAdmin), or
 *   (2) Users who booked storage by paying the fixed price per GB (registerAsUploader).
 *   The storage client calls getIsAllowedUploader(uploader) before accepting POST /upload.
 * - Uploader booking: fixed price per GB (uploaderPricePerGb); user transfers coins and
 *   calls registerAsUploader(amountGb) to become an allowed uploader for that capacity.
 */
import {
  Context,
  Storage,
  generateEvent,
  transferCoins,
  Address,
  balance,
} from '@massalabs/massa-as-sdk';
import {
  Args,
  bytesToU64,
  u64ToBytes,
  bytesToString,
  stringToBytes,
} from '@massalabs/as-types';
import { StorageNode } from '../structs/StorageNode';
import { Challenge } from '../structs/Challenge';
import { PeriodStats } from '../structs/PeriodStats';
import { StorageConfig } from '../structs/StorageConfig';

// ═══════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════════

const NODE_PREFIX = 'node_';
const NODE_INDEX_KEY = 'node_index';
const PROVIDER_META_PREFIX = 'provider_meta_';
const CHALLENGE_PREFIX = 'chal_';
const PERIOD_PREFIX = 'period_';
const CHALLENGER_PREFIX = 'challenger_';
const STORAGE_ADMIN_PREFIX = 'storage_admin_';
const UPLOADER_BOOKING_PREFIX = 'uploader_booking_';
const UPLOADER_INDEX_KEY = 'uploader_index';
const UPLOADER_PRICE_PER_GB_KEY = 'uploader_price_per_gb';
const ADMIN_KEY = 'admin';
const CONFIG_KEY = 'config';
const TOTAL_NODES_KEY = 'total_nodes';
const NODE_INDEX_PREFIX = 'node_idx_';
const PAUSED_KEY = 'paused';

/** Default price per GB for uploader booking (nanoMAS). 1_000_000 = 0.001 MAS per GB */
const DEFAULT_UPLOADER_PRICE_PER_GB: u64 = 1_000_000;

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function nodeKey(address: string): string {
  return NODE_PREFIX + address;
}

function providerMetadataKey(address: string): string {
  return PROVIDER_META_PREFIX + address;
}

function nodeIndexKey(index: u64): string {
  return NODE_INDEX_PREFIX + index.toString();
}

function getNodeAddressAtInternal(index: u64): string {
  const total = getTotalNodes();
  if (index >= total) {
    return '';
  }
  const key = stringToBytes(nodeIndexKey(index));
  if (!Storage.has(key)) {
    return '';
  }
  return bytesToString(Storage.get(key));
}

function challengeKey(id: string): string {
  return CHALLENGE_PREFIX + id;
}

function periodKey(period: u64): string {
  return PERIOD_PREFIX + period.toString();
}

function challengerKey(address: string): string {
  return CHALLENGER_PREFIX + address;
}

function storageAdminKey(address: string): string {
  return STORAGE_ADMIN_PREFIX + address;
}

function uploaderBookingKey(address: string): string {
  return UPLOADER_BOOKING_PREFIX + address;
}

function isStorageAdmin(address: string): bool {
  return Storage.has(stringToBytes(storageAdminKey(address)));
}

function getUploaderPricePerGb(): u64 {
  const key = stringToBytes(UPLOADER_PRICE_PER_GB_KEY);
  if (!Storage.has(key)) {
    return DEFAULT_UPLOADER_PRICE_PER_GB;
  }
  return bytesToU64(Storage.get(key));
}

function setUploaderPricePerGb(pricePerGb: u64): void {
  Storage.set(stringToBytes(UPLOADER_PRICE_PER_GB_KEY), u64ToBytes(pricePerGb));
}

function getBookedUploaderGb(address: string): u64 {
  const key = stringToBytes(uploaderBookingKey(address));
  if (!Storage.has(key)) {
    return 0;
  }
  return bytesToU64(Storage.get(key));
}

function setBookedUploaderGb(address: string, gb: u64): void {
  if (gb === 0) {
    const key = stringToBytes(uploaderBookingKey(address));
    if (Storage.has(key)) {
      Storage.del(key);
    }
    return;
  }
  Storage.set(stringToBytes(uploaderBookingKey(address)), u64ToBytes(gb));
}

function getUploaderIndex(): Array<string> {
  const key = stringToBytes(UPLOADER_INDEX_KEY);
  if (!Storage.has(key)) {
    return [];
  }
  const args = new Args(Storage.get(key), 0);
  return args.nextStringArray().expect('uploader index');
}

function setUploaderIndex(addresses: Array<string>): void {
  Storage.set(
    stringToBytes(UPLOADER_INDEX_KEY),
    new Args().add<Array<string>>(addresses).serialize(),
  );
}

function getConfig(): StorageConfig {
  const config = new StorageConfig();
  if (Storage.has(stringToBytes(CONFIG_KEY))) {
    config.deserialize(Storage.get(stringToBytes(CONFIG_KEY)), 0);
  }
  return config;
}

function setConfig(config: StorageConfig): void {
  Storage.set(stringToBytes(CONFIG_KEY), config.serialize());
}

function getNode(address: string): StorageNode | null {
  const key = stringToBytes(nodeKey(address));
  if (!Storage.has(key)) {
    return null;
  }
  const node = new StorageNode();
  node.deserialize(Storage.get(key), 0);
  return node;
}

function setNode(node: StorageNode): void {
  Storage.set(stringToBytes(nodeKey(node.address)), node.serialize());
}

function getNodeIndex(): Array<string> {
  const key = stringToBytes(NODE_INDEX_KEY);
  if (!Storage.has(key)) {
    return [];
  }
  const args = new Args(Storage.get(key), 0);
  return args.nextStringArray().expect('node index');
}

function setNodeIndex(addresses: Array<string>): void {
  Storage.set(
    stringToBytes(NODE_INDEX_KEY),
    new Args().add<Array<string>>(addresses).serialize(),
  );
}

function getChallenge(id: string): Challenge | null {
  const key = stringToBytes(challengeKey(id));
  if (!Storage.has(key)) {
    return null;
  }
  const challenge = new Challenge();
  challenge.deserialize(Storage.get(key), 0);
  return challenge;
}

function setChallenge(challenge: Challenge): void {
  Storage.set(stringToBytes(challengeKey(challenge.id)), challenge.serialize());
}

function getPeriodStats(period: u64): PeriodStats {
  const key = stringToBytes(periodKey(period));
  const stats = new PeriodStats(period);
  if (Storage.has(key)) {
    stats.deserialize(Storage.get(key), 0);
  }
  return stats;
}

function setPeriodStats(stats: PeriodStats): void {
  Storage.set(stringToBytes(periodKey(stats.period)), stats.serialize());
}

function getTotalNodes(): u64 {
  const key = stringToBytes(TOTAL_NODES_KEY);
  if (!Storage.has(key)) {
    return 0;
  }
  return bytesToU64(Storage.get(key));
}

function setTotalNodes(count: u64): void {
  Storage.set(stringToBytes(TOTAL_NODES_KEY), u64ToBytes(count));
}

/**
 * Get total storage capacity (in GB) advertised by all active providers.
 */
function getTotalAllocatedGbAcrossProviders(): u64 {
  const addresses = getNodeIndex();
  let total: u64 = 0;

  for (let i = 0; i < addresses.length; i++) {
    const node = getNode(addresses[i]);
    if (node === null || !node!.active) {
      continue;
    }
    total += node!.allocatedGb;
  }

  return total;
}

/**
 * Get total storage capacity (in GB) already booked by all uploaders.
 */
function getTotalBookedGbAcrossUploaders(): u64 {
  const uploaders = getUploaderIndex();
  let total: u64 = 0;

  for (let i = 0; i < uploaders.length; i++) {
    total += getBookedUploaderGb(uploaders[i]);
  }

  return total;
}

function isAdmin(address: string): bool {
  const key = stringToBytes(ADMIN_KEY);
  if (!Storage.has(key)) {
    return false;
  }
  return bytesToString(Storage.get(key)) == address;
}

function isChallenger(address: string): bool {
  return Storage.has(stringToBytes(challengerKey(address)));
}

function isPaused(): bool {
  const key = stringToBytes(PAUSED_KEY);
  if (!Storage.has(key)) {
    return false;
  }
  return bytesToString(Storage.get(key)) == 'true';
}

function assertNotPaused(): void {
  assert(!isPaused(), 'Contract is paused');
}

function assertAdmin(): void {
  assert(isAdmin(Context.caller().toString()), 'Caller is not admin');
}

function assertChallenger(): void {
  const caller = Context.caller().toString();
  assert(
    isChallenger(caller) || isAdmin(caller),
    'Caller is not authorized challenger',
  );
}

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Initialize the contract with admin and configuration
 * @param binaryArgs - Serialized Args containing:
 *   - admin: string (admin address)
 *   - config: StorageConfig (optional, uses defaults if not provided)
 */
export function constructor(binaryArgs: StaticArray<u8>): void {
  assert(Context.isDeployingContract(), 'Already deployed');

  const args = new Args(binaryArgs);

  const admin = args
    .nextString()
    .expect('Admin address argument is missing or invalid');

  Storage.set(stringToBytes(ADMIN_KEY), stringToBytes(admin));

  // Try to deserialize config, use defaults if not provided
  const config = new StorageConfig();
  const configResult = args.nextSerializable<StorageConfig>();
  if (!configResult.isErr()) {
    const providedConfig = configResult.unwrap();
    config.rewardPerGbPerPeriod = providedConfig.rewardPerGbPerPeriod;
    config.minAllocatedGb = providedConfig.minAllocatedGb;
    config.maxAllocatedGb = providedConfig.maxAllocatedGb;
    config.challengeResponseTimeout = providedConfig.challengeResponseTimeout;
    config.rewardDistributionPeriod = providedConfig.rewardDistributionPeriod;
  }
  setConfig(config);

  setTotalNodes(0);
  setUploaderPricePerGb(DEFAULT_UPLOADER_PRICE_PER_GB);

  generateEvent('STORAGE_REGISTRY_DEPLOYED:' + admin);
}

// ═══════════════════════════════════════════════════════════════════
// NODE REGISTRATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Register as a storage provider (no staking required).
 * @param binaryArgs - Serialized Args containing:
 *   - allocatedGb: u64 (storage allocation in GB)
 *   - endpoint: string (optional HTTP base URL, e.g. "https://storage1.massa.net" or empty)
 *   - p2pAddrs: Array<string> (optional libp2p multiaddrs; may be empty)
 */
export function registerStorageNode(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();

  const args = new Args(binaryArgs);
  const allocatedGb = args
    .nextU64()
    .expect('allocatedGb argument is missing or invalid');
  
  // Metadata: endpoint and P2P addresses (required but can be empty strings/arrays)
  const endpoint = args.nextString().expect('endpoint argument is missing or invalid');
  const p2pAddrs = args.nextStringArray().expect('p2pAddrs argument is missing or invalid');

  const caller = Context.caller().toString();
  const config = getConfig();

  // Validate allocation
  assert(
    allocatedGb >= config.minAllocatedGb,
    'Allocation below minimum: ' + config.minAllocatedGb.toString() + ' GB',
  );
  assert(
    allocatedGb <= config.maxAllocatedGb,
    'Allocation above maximum: ' + config.maxAllocatedGb.toString() + ' GB',
  );

  // Check not already registered
  const existingNode = getNode(caller);
  assert(existingNode === null, 'Node already registered');

  // Create node (no staking required)
  const node = new StorageNode(caller, allocatedGb, Context.currentPeriod());
  setNode(node);

  // Append to node index for enumeration (getRegisteredAddressesView)
  const index = getNodeIndex();
  if (!index.includes(caller)) {
    index.push(caller);
    setNodeIndex(index);
  }

  // Append address to index list (for getNodeAddressAt)
  const idx = getTotalNodes();
  Storage.set(stringToBytes(nodeIndexKey(idx)), stringToBytes(caller));

  // Update total nodes count
  setTotalNodes(idx + 1);

  // Update period stats
  const stats = getPeriodStats(Context.currentPeriod());
  stats.totalGbStored += allocatedGb;
  stats.activeNodes += 1;
  setPeriodStats(stats);

  // Store provider metadata if provided
  if (endpoint.length > 0 || p2pAddrs.length > 0) {
    const stored = new Args().add(endpoint).add<Array<string>>(p2pAddrs);
    Storage.set(stringToBytes(providerMetadataKey(caller)), stored.serialize());
    
    generateEvent(
      'STORAGE_NODE_REGISTERED:' + caller + ',' + allocatedGb.toString() + ',METADATA:' + endpoint,
    );
  } else {
    generateEvent(
      'STORAGE_NODE_REGISTERED:' + caller + ',' + allocatedGb.toString(),
    );
  }
}

/**
 * Update storage allocation (increase or decrease)
 * @param binaryArgs - Serialized Args containing:
 *   - newAllocatedGb: u64
 */
export function updateStorageAllocation(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();

  const args = new Args(binaryArgs);
  const newAllocatedGb = args
    .nextU64()
    .expect('newAllocatedGb argument is missing or invalid');

  const caller = Context.caller().toString();
  const config = getConfig();

  // Validate allocation
  assert(
    newAllocatedGb >= config.minAllocatedGb,
    'Allocation below minimum: ' + config.minAllocatedGb.toString() + ' GB',
  );
  assert(
    newAllocatedGb <= config.maxAllocatedGb,
    'Allocation above maximum: ' + config.maxAllocatedGb.toString() + ' GB',
  );

  // Get existing node
  const node = getNode(caller);
  assert(node !== null, 'Node not registered');

  const oldGb = node!.allocatedGb;
  node!.allocatedGb = newAllocatedGb;
  setNode(node!);

  // Update period stats
  const stats = getPeriodStats(Context.currentPeriod());
  stats.totalGbStored = stats.totalGbStored - oldGb + newAllocatedGb;
  setPeriodStats(stats);

  generateEvent(
    'STORAGE_NODE_UPDATED:' +
      caller +
      ',' +
      oldGb.toString() +
      ',' +
      newAllocatedGb.toString(),
  );
}

/**
 * Unregister from storage provision
 */
export function unregisterStorageNode(_: StaticArray<u8>): void {
  const caller = Context.caller().toString();

  const node = getNode(caller);
  assert(node !== null, 'Node not registered');
  assert(node!.active, 'Node already inactive');

  // Mark node as inactive
  node!.active = false;
  setNode(node!);

  // Remove from index list: swap with last, then decrement
  const total = getTotalNodes();
  for (let i: u64 = 0; i < total; i++) {
    if (getNodeAddressAtInternal(i) == caller) {
      const lastAddr = getNodeAddressAtInternal(total - 1);
      Storage.set(stringToBytes(nodeIndexKey(i)), stringToBytes(lastAddr));
      break;
    }
  }
  setTotalNodes(total - 1);

  // Update period stats
  const stats = getPeriodStats(Context.currentPeriod());
  stats.totalGbStored -= node!.allocatedGb;
  stats.activeNodes -= 1;
  setPeriodStats(stats);

  generateEvent('STORAGE_NODE_UNREGISTERED:' + caller);
}

// ═══════════════════════════════════════════════════════════════════
// CHALLENGE SYSTEM
// ═══════════════════════════════════════════════════════════════════

/**
 * Issue a challenge to a storage node
 * Only callable by authorized challenger addresses
 * @param binaryArgs - Serialized Args containing:
 *   - challengeId: string (unique hash)
 *   - nodeAddress: string
 *   - chunkId: string
 *   - nonce: u64
 */
export function issueChallenge(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();
  assertChallenger();

  const args = new Args(binaryArgs);
  const challengeId = args
    .nextString()
    .expect('challengeId argument is missing');
  const nodeAddress = args
    .nextString()
    .expect('nodeAddress argument is missing');
  const chunkId = args.nextString().expect('chunkId argument is missing');
  const nonce = args.nextU64().expect('nonce argument is missing');

  // Validate challenge doesn't exist
  assert(getChallenge(challengeId) === null, 'Challenge already exists');

  // Validate node exists and is active
  const node = getNode(nodeAddress);
  assert(node !== null, 'Node not found');
  assert(node!.active, 'Node is not active');

  const config = getConfig();
  const deadline = Context.timestamp() + config.challengeResponseTimeout;

  const challenge = new Challenge(
    challengeId,
    nodeAddress,
    chunkId,
    nonce,
    Context.currentPeriod(),
    deadline,
  );
  setChallenge(challenge);

  // Update node challenge count
  node!.totalChallenges += 1;
  node!.lastChallengedPeriod = Context.currentPeriod();
  setNode(node!);

  // Update period stats
  const stats = getPeriodStats(Context.currentPeriod());
  stats.challengesIssued += 1;
  setPeriodStats(stats);

  generateEvent(
    'CHALLENGE_ISSUED:' + challengeId + ',' + nodeAddress + ',' + chunkId,
  );
}

/**
 * Submit proof for a challenge
 * @param binaryArgs - Serialized Args containing:
 *   - challengeId: string
 *   - merkleProof: StaticArray<u8> (serialized Merkle proof)
 */
export function submitProof(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();

  const args = new Args(binaryArgs);
  const challengeId = args
    .nextString()
    .expect('challengeId argument is missing');
  const merkleProof = args
    .nextBytes()
    .expect('merkleProof argument is missing');

  const challenge = getChallenge(challengeId);
  assert(challenge !== null, 'Challenge not found');
  assert(!challenge!.resolved, 'Challenge already resolved');

  const caller = Context.caller().toString();
  assert(caller == challenge!.nodeAddress, 'Caller is not the challenged node');

  // Check deadline
  const currentTime = Context.timestamp();
  assert(currentTime <= challenge!.deadline, 'Challenge deadline passed');

  // Verify the proof
  // TODO: Implement actual Merkle proof verification
  // For now, we accept any non-empty proof as valid
  const proofValid = merkleProof.length > 0;

  challenge!.resolved = true;
  challenge!.passed = proofValid;
  setChallenge(challenge!);

  // Update node stats
  const node = getNode(challenge!.nodeAddress);
  if (node !== null) {
    if (proofValid) {
      node!.passedChallenges += 1;
      generateEvent('CHALLENGE_PASSED:' + challengeId + ',' + caller);
    } else {
      // No slashing - just mark as failed
      generateEvent(
        'CHALLENGE_FAILED:' + challengeId + ',' + caller + ',invalid_proof',
      );
    }
    setNode(node!);
  }

  // Update period stats
  const stats = getPeriodStats(challenge!.issuedPeriod);
  if (proofValid) {
    stats.challengesPassed += 1;
  }
  setPeriodStats(stats);
}

/**
 * Mark expired challenges as failed (no slashing)
 * @param binaryArgs - Serialized Args containing:
 *   - challengeIds: Array<string>
 */
export function resolveExpiredChallenges(binaryArgs: StaticArray<u8>): void {
  const args = new Args(binaryArgs);
  const challengeIds = args
    .nextStringArray()
    .expect('challengeIds argument is missing');

  const currentTime = Context.timestamp();

  for (let i = 0; i < challengeIds.length; i++) {
    const challenge = getChallenge(challengeIds[i]);
    if (challenge === null || challenge!.resolved) {
      continue;
    }

    if (currentTime > challenge!.deadline) {
      challenge!.resolved = true;
      challenge!.passed = false;
      setChallenge(challenge!);

      generateEvent(
        'CHALLENGE_EXPIRED:' + challengeIds[i] + ',' + challenge!.nodeAddress,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// REWARD DISTRIBUTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Distribute rewards for a completed period.
 * All providers must have been challenged for this period before distribution.
 * Only nodes that passed their challenge receive rewards (no staking, no slashing).
 *
 * @param binaryArgs - Serialized Args containing:
 *   - period: u64
 *   - nodeAddresses: Array<string> (all active provider addresses for this period)
 */
export function distributeRewards(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();
  assertChallenger(); // Only protocol can distribute rewards

  const args = new Args(binaryArgs);
  const period = args.nextU64().expect('period argument is missing');
  const nodeAddresses = args
    .nextStringArray()
    .expect('nodeAddresses argument is missing');

  const stats = getPeriodStats(period);
  assert(!stats.rewardsDistributed, 'Rewards already distributed for period');

  // Require all providers to have been challenged before distributing rewards
  for (let i = 0; i < nodeAddresses.length; i++) {
    const node = getNode(nodeAddresses[i]);
    if (node === null || !node!.active) {
      continue; // Skip inactive/unregistered
    }
    assert(
      node!.lastChallengedPeriod == period,
      'All providers must be challenged for this period before distributing rewards',
    );
  }

  const config = getConfig();
  let totalDistributed: u64 = 0;
  let nodeCount: u64 = 0;

  for (let i = 0; i < nodeAddresses.length; i++) {
    const node = getNode(nodeAddresses[i]);
    if (node === null || !node!.active) {
      continue;
    }

    // Only reward nodes that passed all their challenges for this period
    if (node!.passedChallenges != node!.totalChallenges) {
      generateEvent(
        'REWARD_SKIPPED:' + nodeAddresses[i] + ',challenge_not_passed',
      );
      continue;
    }

    // Calculate reward: allocatedGb × rewardPerGbPerPeriod
    const reward = node!.allocatedGb * config.rewardPerGbPerPeriod;

    if (reward > 0) {
      node!.pendingRewards += reward;
      node!.lastRewardedPeriod = period;
      setNode(node!);
      totalDistributed += reward;
      nodeCount += 1;
    }
  }

  stats.totalRewardsDistributed = totalDistributed;
  stats.rewardsDistributed = true;
  setPeriodStats(stats);

  generateEvent(
    'REWARDS_DISTRIBUTED:' +
      period.toString() +
      ',' +
      totalDistributed.toString() +
      ',' +
      nodeCount.toString(),
  );
}

/**
 * Claim accumulated rewards
 */
export function claimRewards(_: StaticArray<u8>): void {
  assertNotPaused();

  const caller = Context.caller().toString();
  const node = getNode(caller);

  assert(node !== null, 'Node not registered');
  assert(node!.pendingRewards > 0, 'No rewards to claim');

  const amount = node!.pendingRewards;

  // Check contract has enough balance
  const contractBalance = balance();
  assert(contractBalance >= amount, 'Insufficient contract balance');

  node!.pendingRewards = 0;
  setNode(node!);

  transferCoins(new Address(caller), amount);

  generateEvent('REWARDS_CLAIMED:' + caller + ',' + amount.toString());
}

/**
 * Update storage provider metadata (called by the storage provider itself).
 *
 * This lets a node advertise:
 * - Its public HTTP endpoint (base URL for the massa-storage-server)
 * - Its P2P multiaddrs (libp2p addresses used by other storage clients/nodes)
 *
 * @param binaryArgs - Serialized Args containing:
 *   - endpoint: string (HTTP base URL, e.g. "https://storage1.massa.net" or empty)
 *   - p2pAddrs: Array<string> (libp2p multiaddrs; may be empty)
 */
export function updateProviderMetadata(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();

  const caller = Context.caller().toString();

  // Only registered storage nodes can set metadata.
  const node = getNode(caller);
  assert(node !== null, 'Node not registered');

  const args = new Args(binaryArgs);
  const endpoint = args
    .nextString()
    .expect('endpoint argument is missing or invalid');
  const p2pAddrs = args
    .nextStringArray()
    .expect('p2pAddrs argument is missing or invalid');

  const stored = new Args().add(endpoint).add<Array<string>>(p2pAddrs);
  Storage.set(stringToBytes(providerMetadataKey(caller)), stored.serialize());

  generateEvent(
    'PROVIDER_METADATA_UPDATED:' + caller + ',' + endpoint.toString(),
  );
}

// ═══════════════════════════════════════════════════════════════════
// UPLOADER BOOKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Register as an allowed uploader by booking storage capacity. Caller must transfer
 * exactly amountGb * uploaderPricePerGb (nanoMAS) to the contract. Booked GB is
 * cumulative (can call again to add more). The server uses getIsAllowedUploader(address)
 * to allow uploads from storage admins or addresses with booked capacity.
 * @param binaryArgs - Serialized Args containing:
 *   - amountGb: u64 (number of GB to book)
 */
export function registerAsUploader(binaryArgs: StaticArray<u8>): void {
  assertNotPaused();

  const args = new Args(binaryArgs);
  const amountGb = args
    .nextU64()
    .expect('amountGb argument is missing or invalid');

  assert(amountGb > 0, 'amountGb must be greater than 0');

  const pricePerGb = getUploaderPricePerGb();
  const requiredPayment = amountGb * pricePerGb;
  const transferred = Context.transferredCoins();
  assert(
    transferred >= requiredPayment,
    'Insufficient payment: need ' +
      requiredPayment.toString() +
      ' nanoMAS for ' +
      amountGb.toString() +
      ' GB at ' +
      pricePerGb.toString() +
      ' per GB',
  );

  const caller = Context.caller().toString();
  const existingGb = getBookedUploaderGb(caller);
  const newTotalGb = existingGb + amountGb;
  setBookedUploaderGb(caller, newTotalGb);

  const index = getUploaderIndex();
  if (!index.includes(caller)) {
    index.push(caller);
    setUploaderIndex(index);
  }

  generateEvent(
    'UPLOADER_BOOKED:' +
      caller +
      ',' +
      amountGb.toString() +
      ',' +
      newTotalGb.toString(),
  );
}

// ═══════════════════════════════════════════════════════════════════
// VIEW FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get storage node information
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns Serialized StorageNode
 */
export function getNodeInfo(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  const node = getNode(address);
  assert(node !== null, 'Node not found');

  return node!.serialize();
}

/**
 * Get provider metadata (HTTP endpoint and P2P multiaddrs) for a storage node.
 * This allows external clients to discover how to reach a storage provider
 * given its Massa address.
 *
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns Serialized Args:
 *   - endpoint: string (HTTP base URL or empty string if not set)
 *   - p2pAddrs: Array<string> (libp2p multiaddrs; may be empty)
 */
export function getProviderMetadataView(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  const key = stringToBytes(providerMetadataKey(address));
  if (!Storage.has(key)) {
    // For now we treat missing metadata as "not set".
    // Return empty endpoint and empty P2P address list.
    return new Args().add('').add<Array<string>>([]).serialize();
  }

  return Storage.get(key);
}

/**
 * Get all registered node addresses (for enumeration / list-providers script).
 * Only includes addresses that registered after this view was added to the contract.
 * @param _ - unused
 * @returns Serialized Array<string> of Massa addresses
 */
export function getRegisteredAddressesView(
  _: StaticArray<u8>,
): StaticArray<u8> {
  const addresses = getNodeIndex();
  return new Args().add<Array<string>>(addresses).serialize();
}

/**
 * Get challenge information
 * @param binaryArgs - Serialized Args containing:
 *   - challengeId: string
 * @returns Serialized Challenge
 */
export function getChallengeInfo(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const challengeId = args
    .nextString()
    .expect('challengeId argument is missing');

  const challenge = getChallenge(challengeId);
  assert(challenge !== null, 'Challenge not found');

  return challenge!.serialize();
}

/**
 * Get period statistics
 * @param binaryArgs - Serialized Args containing:
 *   - period: u64
 * @returns Serialized PeriodStats
 */
export function getPeriodStatsView(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const period = args.nextU64().expect('period argument is missing');

  return getPeriodStats(period).serialize();
}

/**
 * Get contract configuration
 * @returns Serialized StorageConfig
 */
export function getConfigView(_: StaticArray<u8>): StaticArray<u8> {
  return getConfig().serialize();
}

/**
 * Get total registered nodes count
 * @returns u64 as bytes
 */
export function getTotalNodesCount(_: StaticArray<u8>): StaticArray<u8> {
  return u64ToBytes(getTotalNodes());
}

/**
 * Get node address by index (for listing providers).
 * @param binaryArgs - Serialized Args containing: index (u64)
 * @returns Serialized string (address, or empty if index out of range)
 */
export function getNodeAddressAt(binaryArgs: StaticArray<u8>): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const index = args.nextU64().expect('index argument is missing');
  const address = getNodeAddressAtInternal(index);
  const out = new Args();
  out.add(address);
  return out.serialize();
}

/**
 * Get global storage usage statistics across all providers and uploaders.
 * Returns serialized Args:
 *   - totalAllocatedGb: u64
 *   - totalBookedGb: u64
 *   - availableGb: u64
 */
export function getGlobalStorageUsageView(_: StaticArray<u8>): StaticArray<u8> {
  const totalAllocatedGb = getTotalAllocatedGbAcrossProviders();
  const totalBookedGb = getTotalBookedGbAcrossUploaders();

  let availableGb: u64 = 0;
  if (totalAllocatedGb > totalBookedGb) {
    availableGb = totalAllocatedGb - totalBookedGb;
  }

  return new Args()
    .add<u64>(totalAllocatedGb)
    .add<u64>(totalBookedGb)
    .add<u64>(availableGb)
    .serialize();
}

/**
 * Calculate pending rewards for a node
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns u64 pending rewards in nanoMAS
 */
export function calculatePendingRewards(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  const node = getNode(address);
  if (node === null) {
    return u64ToBytes(0);
  }

  return u64ToBytes(node!.pendingRewards);
}

/**
 * Check if an address is a cloud storage admin (added by admin via addStorageAdmin).
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns Serialized bool as u64 (1 = true, 0 = false)
 */
export function getIsStorageAdmin(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  return u64ToBytes(isStorageAdmin(address) ? 1 : 0);
}

/**
 * Check if an address is allowed to upload: either a storage admin or has booked
 * storage capacity (paid registerAsUploader). Used by the storage server before accepting POST /upload.
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns Serialized bool as u64 (1 = true, 0 = false)
 */
export function getIsAllowedUploader(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  const allowed = isStorageAdmin(address) || getBookedUploaderGb(address) > 0;
  return u64ToBytes(allowed ? 1 : 0);
}

/**
 * Get the number of GB booked by an address (paid via registerAsUploader).
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 * @returns Serialized u64 (booked GB)
 */
export function getBookedUploaderGbView(
  binaryArgs: StaticArray<u8>,
): StaticArray<u8> {
  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  return u64ToBytes(getBookedUploaderGb(address));
}

/**
 * Get the current price per GB for uploader booking (nanoMAS). Used to compute
 * payment for registerAsUploader(amountGb).
 * @param _ - unused
 * @returns Serialized u64
 */
export function getUploaderPricePerGbView(_: StaticArray<u8>): StaticArray<u8> {
  return u64ToBytes(getUploaderPricePerGb());
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Update contract configuration (admin only)
 * @param binaryArgs - Serialized StorageConfig
 */
export function updateConfig(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const newConfig = args
    .nextSerializable<StorageConfig>()
    .expect('config argument is missing');

  setConfig(newConfig);

  generateEvent('CONFIG_UPDATED');
}

/**
 * Add authorized challenger address (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 */
export function addChallenger(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  Storage.set(stringToBytes(challengerKey(address)), stringToBytes('true'));

  generateEvent('CHALLENGER_ADDED:' + address);
}

/**
 * Remove authorized challenger address (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 */
export function removeChallenger(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  const key = stringToBytes(challengerKey(address));
  if (Storage.has(key)) {
    Storage.del(key);
  }

  generateEvent('CHALLENGER_REMOVED:' + address);
}

/**
 * Add cloud storage admin (uploader) address (admin only).
 * Storage admins are allowed to upload data to the storage client; the client
 * verifies uploader via getIsStorageAdmin before accepting uploads.
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 */
export function addStorageAdmin(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  Storage.set(stringToBytes(storageAdminKey(address)), stringToBytes('true'));

  generateEvent('STORAGE_ADMIN_ADDED:' + address);
}

/**
 * Remove cloud storage admin address (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - address: string
 */
export function removeStorageAdmin(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const address = args.nextString().expect('address argument is missing');

  const key = stringToBytes(storageAdminKey(address));
  if (Storage.has(key)) {
    Storage.del(key);
  }

  generateEvent('STORAGE_ADMIN_REMOVED:' + address);
}

/**
 * Set the fixed price per GB for uploader booking (admin only). In nanoMAS.
 * @param binaryArgs - Serialized Args containing:
 *   - pricePerGb: u64
 */
export function setUploaderPricePerGbAdmin(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const pricePerGb = args
    .nextU64()
    .expect('pricePerGb argument is missing or invalid');

  assert(pricePerGb > 0, 'pricePerGb must be greater than 0');
  setUploaderPricePerGb(pricePerGb);

  generateEvent('UPLOADER_PRICE_PER_GB_SET:' + pricePerGb.toString());
}

/**
 * Emergency pause/unpause contract (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - paused: bool
 */
export function setPaused(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const paused = args.nextBool().expect('paused argument is missing');

  Storage.set(
    stringToBytes(PAUSED_KEY),
    stringToBytes(paused ? 'true' : 'false'),
  );

  generateEvent('CONTRACT_PAUSED:' + paused.toString());
}

/**
 * Transfer admin role (admin only)
 * @param binaryArgs - Serialized Args containing:
 *   - newAdmin: string
 */
export function transferAdmin(binaryArgs: StaticArray<u8>): void {
  assertAdmin();

  const args = new Args(binaryArgs);
  const newAdmin = args.nextString().expect('newAdmin argument is missing');

  Storage.set(stringToBytes(ADMIN_KEY), stringToBytes(newAdmin));

  generateEvent('ADMIN_TRANSFERRED:' + newAdmin);
}

/**
 * Fund contract with MAS for reward distribution (anyone can call)
 */
export function fundContract(_: StaticArray<u8>): void {
  const amount = Context.transferredCoins();
  assert(amount > 0, 'No coins transferred');

  generateEvent(
    'CONTRACT_FUNDED:' + Context.caller().toString() + ',' + amount.toString(),
  );
}

import {
  resetStorage,
  setDeployContext,
  mockBalance,
  mockTransferredCoins,
  changeCallStack,
} from '@massalabs/massa-as-sdk';
import { Args, bytesToU64 } from '@massalabs/as-types';
import {
  constructor,
  registerStorageNode,
  getConfigView,
  getNodeInfo,
  getProviderMetadataView,
  getRegisteredAddressesView,
  getIsStorageAdmin,
  getIsAllowedUploader,
  getBookedUploaderGbView,
  getUploaderPricePerGbView,
  addChallenger,
  addStorageAdmin,
  removeStorageAdmin,
  registerAsUploader,
  issueChallenge,
  submitProof,
  distributeRewards,
  fundContract,
  unregisterStorageNode,
  updateProviderMetadata,
  recordFileUpload,
  removeFileUpload,
  getUploaderUsageView,
} from '../contracts/storage-registry';
import { StorageNode } from '../structs/StorageNode';
import { StorageConfig } from '../structs/StorageConfig';

// Valid Massa addresses
const ADMIN_ADDRESS = 'AU12UBnqTHDQALpocVBnkPNy7y5CndUJQTLutaVDDFgMJcq5kQiKq';
const NODE_ADDRESS = 'AU12E6N5BFAdC2JUTteDDstnx5xRCVz9vwXMMti2UTHKtkPtbrkkf';
const CHALLENGER_ADDRESS =
  'AU12FMsrsnBTjuFmP87nM7y6YMhfEyVpehWsqFSMfQoMoiPbRvW6Q';
const CONTRACT_ADDRESS = 'AS12BqZEQ6sByhRLyEuf0YbQmcF2PsDdkNNG1akBJu9XcjZA1eT';

function switchUser(address: string): void {
  changeCallStack(address + ' , ' + CONTRACT_ADDRESS);
}

function deployContract(): void {
  resetStorage();
  setDeployContext(ADMIN_ADDRESS);
  const constructorArgs = new Args().add(ADMIN_ADDRESS).serialize();
  constructor(constructorArgs);
}

/** Build args for registerStorageNode: allocatedGb, endpoint, p2pAddrs (all required by contract). */
function registerNodeArgs(
  allocatedGb: u64,
  endpoint: string = '',
  p2pAddrs: Array<string> = [],
): StaticArray<u8> {
  return new Args()
    .add<u64>(allocatedGb)
    .add(endpoint)
    .add<Array<string>>(p2pAddrs)
    .serialize();
}

describe('Storage Registry - Constructor', () => {
  beforeEach(() => {
    deployContract();
  });

  it('should initialize with default config values', () => {
    const configBytes = getConfigView(new StaticArray<u8>(0));
    const config = new StorageConfig();
    config.deserialize(configBytes, 0);

    expect(config.minAllocatedGb).toBe(1);
    expect(config.maxAllocatedGb).toBe(1000);
    expect(config.rewardPerGbPerPeriod).toBe(1_000_000);
  });
});

describe('Storage Registry - Provider Metadata', () => {
  beforeEach(() => {
    deployContract();

    // Register a node (endpoint/p2pAddrs optional, can be empty)
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(10));
  });

  it('should allow a registered node to update and read its metadata', () => {
    switchUser(NODE_ADDRESS);

    const endpoint = 'https://storage1.massa.net';
    const p2pAddrs = ['/ip4/1.2.3.4/tcp/4001/p2p/peer1'];

    const updateArgs = new Args().add(endpoint).add<Array<string>>(p2pAddrs);
    updateProviderMetadata(updateArgs.serialize());

    const viewArgs = new Args().add(NODE_ADDRESS).serialize();
    const metaBytes = getProviderMetadataView(viewArgs);
    const metaArgs = new Args(metaBytes);

    const decodedEndpoint = metaArgs.nextString().expect('endpoint');
    const decodedAddrs = metaArgs.nextStringArray().expect('p2p addrs');

    expect(decodedEndpoint).toBe(endpoint);
    expect(decodedAddrs.length).toBe(1);
    expect(decodedAddrs[0]).toBe(p2pAddrs[0]);
  });

  it('getProviderMetadataView returns empty metadata when not set', () => {
    // Fresh deploy + registration, but no metadata set yet.
    const viewArgs = new Args().add(NODE_ADDRESS).serialize();
    const metaBytes = getProviderMetadataView(viewArgs);
    const metaArgs = new Args(metaBytes);

    const decodedEndpoint = metaArgs.nextString().expect('endpoint');
    const decodedAddrs = metaArgs.nextStringArray().expect('p2p addrs');

    expect(decodedEndpoint).toBe('');
    expect(decodedAddrs.length).toBe(0);
  });

  throws(
    'should fail to update metadata when caller is not a registered node',
    () => {
      const OTHER_ADDRESS =
        'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3zz';
      switchUser(OTHER_ADDRESS);

      const updateArgs = new Args()
        .add('https://storage2.massa.net')
        .add<Array<string>>([]);
      updateProviderMetadata(updateArgs.serialize());
    },
  );
});

describe('Storage Registry - Node Registration (No Staking)', () => {
  beforeEach(() => {
    deployContract();
  });

  it('should register a storage node without requiring stake', () => {
    switchUser(NODE_ADDRESS);
    // No need to mock transferred coins - no staking required

    registerStorageNode(registerNodeArgs(10));

    // Verify node info
    const nodeInfoArgs = new Args().add(NODE_ADDRESS).serialize();
    const nodeBytes = getNodeInfo(nodeInfoArgs);
    const node = new StorageNode();
    node.deserialize(nodeBytes, 0);

    expect(node.allocatedGb).toBe(10);
    expect(node.active).toBe(true);
  });

  it('getRegisteredAddressesView returns registered node address', () => {
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(10));

    const viewBytes = getRegisteredAddressesView(new StaticArray<u8>(0));
    const viewArgs = new Args(viewBytes);
    const addresses = viewArgs.nextStringArray().expect('addresses');
    expect(addresses.length).toBe(1);
    expect(addresses[0]).toBe(NODE_ADDRESS);
  });

  throws('should fail with allocation below minimum', () => {
    switchUser(NODE_ADDRESS);

    registerStorageNode(registerNodeArgs(0)); // 0 GB - below minimum of 1
  });

  throws('should fail with allocation above maximum', () => {
    switchUser(NODE_ADDRESS);

    registerStorageNode(registerNodeArgs(2000)); // Above max 1000
  });

  it('should allow node to unregister', () => {
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(10));

    unregisterStorageNode(new StaticArray<u8>(0));

    // Verify node is inactive
    const nodeInfoArgs = new Args().add(NODE_ADDRESS).serialize();
    const nodeBytes = getNodeInfo(nodeInfoArgs);
    const node = new StorageNode();
    node.deserialize(nodeBytes, 0);

    expect(node.active).toBe(false);
  });
});

describe('Storage Registry - Admin Functions', () => {
  beforeEach(() => {
    deployContract();
  });

  it('should add challenger when called by admin', () => {
    switchUser(ADMIN_ADDRESS);
    const args = new Args().add(CHALLENGER_ADDRESS).serialize();
    addChallenger(args);
  });

  throws('should fail to add challenger when called by non-admin', () => {
    switchUser(NODE_ADDRESS);
    const args = new Args().add(CHALLENGER_ADDRESS).serialize();
    addChallenger(args);
  });
});

describe('Storage Registry - Cloud Storage Admins', () => {
  const UPLOADER_ADDRESS =
    'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3yh';

  beforeEach(() => {
    deployContract();
  });

  it('should add storage admin when called by admin', () => {
    switchUser(ADMIN_ADDRESS);
    const args = new Args().add(UPLOADER_ADDRESS).serialize();
    addStorageAdmin(args);

    const resultArgs = new Args().add(UPLOADER_ADDRESS).serialize();
    const result = getIsStorageAdmin(resultArgs);
    expect(bytesToU64(result)).toBe(1);
  });

  it('getIsStorageAdmin returns 0 for non-admin address', () => {
    const resultArgs = new Args().add(UPLOADER_ADDRESS).serialize();
    const result = getIsStorageAdmin(resultArgs);
    expect(bytesToU64(result)).toBe(0);
  });

  it('should remove storage admin when called by admin', () => {
    switchUser(ADMIN_ADDRESS);
    addStorageAdmin(new Args().add(UPLOADER_ADDRESS).serialize());
    removeStorageAdmin(new Args().add(UPLOADER_ADDRESS).serialize());

    const resultArgs = new Args().add(UPLOADER_ADDRESS).serialize();
    const result = getIsStorageAdmin(resultArgs);
    expect(bytesToU64(result)).toBe(0);
  });

  throws('should fail to add storage admin when called by non-admin', () => {
    switchUser(NODE_ADDRESS);
    const args = new Args().add(UPLOADER_ADDRESS).serialize();
    addStorageAdmin(args);
  });
});

describe('Storage Registry - Challenge System', () => {
  beforeEach(() => {
    deployContract();

    // Add challenger
    switchUser(ADMIN_ADDRESS);
    addChallenger(new Args().add(CHALLENGER_ADDRESS).serialize());

    // Register a node (no staking needed)
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(10));
  });

  it('should allow challenger to issue challenge', () => {
    switchUser(CHALLENGER_ADDRESS);
    const challengeArgs = new Args()
      .add('challenge_001')
      .add(NODE_ADDRESS)
      .add('chunk_abc123')
      .add<u64>(12345)
      .serialize();

    issueChallenge(challengeArgs);

    // Verify node's challenge count increased
    const nodeInfoArgs = new Args().add(NODE_ADDRESS).serialize();
    const nodeBytes = getNodeInfo(nodeInfoArgs);
    const node = new StorageNode();
    node.deserialize(nodeBytes, 0);

    expect(node.totalChallenges).toBe(1);
  });

  it('should allow node to submit proof and pass challenge', () => {
    // Issue challenge first
    switchUser(CHALLENGER_ADDRESS);
    issueChallenge(
      new Args()
        .add('challenge_001')
        .add(NODE_ADDRESS)
        .add('chunk_abc123')
        .add<u64>(12345)
        .serialize(),
    );

    // Submit proof as node
    switchUser(NODE_ADDRESS);
    const proofArgs = new Args()
      .add('challenge_001')
      .add<StaticArray<u8>>(StaticArray.fromArray<u8>([1, 2, 3, 4])) // Non-empty proof
      .serialize();
    submitProof(proofArgs);

    // Verify node passed the challenge
    const nodeInfoArgs = new Args().add(NODE_ADDRESS).serialize();
    const nodeBytes = getNodeInfo(nodeInfoArgs);
    const node = new StorageNode();
    node.deserialize(nodeBytes, 0);

    expect(node.passedChallenges).toBe(1);
  });

  throws('should fail when non-challenger issues challenge', () => {
    const OTHER_ADDRESS =
      'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3yh';
    switchUser(OTHER_ADDRESS);
    const challengeArgs = new Args()
      .add('challenge_002')
      .add(NODE_ADDRESS)
      .add('chunk_xyz')
      .add<u64>(99999)
      .serialize();

    issueChallenge(challengeArgs);
  });
});

describe('Storage Registry - Reward Distribution', () => {
  beforeEach(() => {
    deployContract();
    mockBalance(CONTRACT_ADDRESS, 1_000_000_000_000);

    // Add challenger
    switchUser(ADMIN_ADDRESS);
    addChallenger(new Args().add(CHALLENGER_ADDRESS).serialize());

    // Register a node
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(10));
  });

  it('should distribute rewards only to nodes that passed challenge', () => {
    // Issue and pass challenge
    switchUser(CHALLENGER_ADDRESS);
    issueChallenge(
      new Args()
        .add('challenge_period_0')
        .add(NODE_ADDRESS)
        .add('chunk_1')
        .add<u64>(1)
        .serialize(),
    );

    switchUser(NODE_ADDRESS);
    submitProof(
      new Args()
        .add('challenge_period_0')
        .add<StaticArray<u8>>(StaticArray.fromArray<u8>([1, 2, 3]))
        .serialize(),
    );

    // Distribute rewards for period 0
    switchUser(CHALLENGER_ADDRESS);
    const distributeArgs = new Args()
      .add<u64>(0) // period
      .add<Array<string>>([NODE_ADDRESS])
      .serialize();
    distributeRewards(distributeArgs);

    // Check node has pending rewards (10 GB * 1_000_000 nanoMAS = 10_000_000)
    const nodeInfoArgs = new Args().add(NODE_ADDRESS).serialize();
    const nodeBytes = getNodeInfo(nodeInfoArgs);
    const node = new StorageNode();
    node.deserialize(nodeBytes, 0);

    expect(node.pendingRewards).toBe(10_000_000);
  });

  throws(
    'should fail to distribute rewards until all providers are challenged',
    () => {
      // Register a second node but do NOT challenge it
      const NODE2 = 'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3yh';
      switchUser(NODE2);
      registerStorageNode(registerNodeArgs(5));

      // Challenge only the first node and pass
      switchUser(CHALLENGER_ADDRESS);
      issueChallenge(
        new Args()
          .add('challenge_period_0')
          .add(NODE_ADDRESS)
          .add('chunk_1')
          .add<u64>(1)
          .serialize(),
      );
      switchUser(NODE_ADDRESS);
      submitProof(
        new Args()
          .add('challenge_period_0')
          .add<StaticArray<u8>>(StaticArray.fromArray<u8>([1, 2, 3]))
          .serialize(),
      );

      // Try to distribute with both nodes - must fail (NODE2 not challenged)
      switchUser(CHALLENGER_ADDRESS);
      const distributeArgs = new Args()
        .add<u64>(0)
        .add<Array<string>>([NODE_ADDRESS, NODE2])
        .serialize();
      distributeRewards(distributeArgs);
    },
  );
});

describe('Storage Registry - Fund Contract', () => {
  beforeEach(() => {
    deployContract();
    mockBalance(NODE_ADDRESS, 1_000_000_000_000);
  });

  it('should accept funds from anyone', () => {
    switchUser(NODE_ADDRESS);
    mockTransferredCoins(1_000_000_000);
    fundContract(new StaticArray<u8>(0));
  });

  throws('should fail with zero coins', () => {
    switchUser(NODE_ADDRESS);
    mockTransferredCoins(0);
    fundContract(new StaticArray<u8>(0));
  });
});

describe('Storage Registry - Uploader booking', () => {
  const UPLOADER_ADDRESS =
    'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3yh';
  const DEFAULT_PRICE_PER_GB: u64 = 1_000_000;

  beforeEach(() => {
    deployContract();
    // Register a storage node so there is capacity to book
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(100));
  });

  it('should return default price per GB', () => {
    const bytes = getUploaderPricePerGbView(new StaticArray<u8>(0));
    expect(bytesToU64(bytes)).toBe(DEFAULT_PRICE_PER_GB);
  });

  it('should allow booking storage by paying fee', () => {
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000); // ensure address exists and has balance
    const amountGb: u64 = 2;
    const requiredPayment = amountGb * DEFAULT_PRICE_PER_GB;
    mockTransferredCoins(requiredPayment);

    registerAsUploader(new Args().add(amountGb).serialize());

    const bookedBytes = getBookedUploaderGbView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(bookedBytes)).toBe(amountGb);

    const allowedBytes = getIsAllowedUploader(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(allowedBytes)).toBe(1);
  });

  it('should reject booking with insufficient payment', () => {
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    const amountGb: u64 = 2;
    mockTransferredCoins(amountGb * DEFAULT_PRICE_PER_GB - 1);

    throws('Insufficient payment', () => {
      registerAsUploader(new Args().add(amountGb).serialize());
    });
  });

  it('should allow storage admin without booking', () => {
    switchUser(ADMIN_ADDRESS);
    addStorageAdmin(new Args().add(UPLOADER_ADDRESS).serialize());

    const allowedBytes = getIsAllowedUploader(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(allowedBytes)).toBe(1);
  });
});

describe('Storage Registry - File Upload Tracking', () => {
  const UPLOADER_ADDRESS =
    'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3yh';
  const STORAGE_ADMIN_ADDRESS =
    'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3zz';
  const DEFAULT_PRICE_PER_GB: u64 = 1_000_000;

  beforeEach(() => {
    deployContract();
    // Register a storage node so there is capacity to book
    switchUser(NODE_ADDRESS);
    registerStorageNode(registerNodeArgs(100));
    // Add a storage admin (server) that can record uploads
    switchUser(ADMIN_ADDRESS);
    addStorageAdmin(new Args().add(STORAGE_ADMIN_ADDRESS).serialize());
  });

  it('should return zero usage for uploader with no files', () => {
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(0);
  });

  it('should allow storage admin to record file upload', () => {
    // First, register uploader with booked capacity
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    const amountGb: u64 = 5;
    mockTransferredCoins(amountGb * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add(amountGb).serialize());

    // Now record a file upload as storage admin
    switchUser(STORAGE_ADMIN_ADDRESS);
    const fileSizeBytes: u64 = 1_000_000_000; // 1 GB
    const recordArgs = new Args()
      .add(UPLOADER_ADDRESS)
      .add<u64>(fileSizeBytes)
      .serialize();
    recordFileUpload(recordArgs);

    // Verify usage was recorded
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(fileSizeBytes);
  });

  it('should track cumulative file uploads', () => {
    // Register uploader
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(10 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(10).serialize());

    // Record multiple file uploads
    switchUser(STORAGE_ADMIN_ADDRESS);
    const file1Size: u64 = 500_000_000; // 0.5 GB
    const file2Size: u64 = 1_500_000_000; // 1.5 GB
    const file3Size: u64 = 300_000_000; // 0.3 GB

    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file1Size).serialize(),
    );
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file2Size).serialize(),
    );
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file3Size).serialize(),
    );

    // Verify cumulative usage
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(file1Size + file2Size + file3Size);
  });

  it('should allow recording uploads for storage admin uploaders', () => {
    // Add uploader as storage admin (no booking needed)
    switchUser(ADMIN_ADDRESS);
    addStorageAdmin(new Args().add(UPLOADER_ADDRESS).serialize());

    // Record file upload for storage admin uploader
    switchUser(STORAGE_ADMIN_ADDRESS);
    const fileSizeBytes: u64 = 2_000_000_000; // 2 GB
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(fileSizeBytes).serialize(),
    );

    // Verify usage was recorded
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(fileSizeBytes);
  });

  throws(
    'should fail to record upload when caller is not storage admin',
    () => {
      // Register uploader
      switchUser(UPLOADER_ADDRESS);
      mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
      mockTransferredCoins(5 * DEFAULT_PRICE_PER_GB);
      registerAsUploader(new Args().add<u64>(5).serialize());

      // Try to record as non-admin (should fail)
      switchUser(UPLOADER_ADDRESS);
      recordFileUpload(
        new Args().add(UPLOADER_ADDRESS).add<u64>(1_000_000_000).serialize(),
      );
    },
  );

  throws('should fail to record upload for non-allowed uploader', () => {
    const NOT_ALLOWED_ADDRESS =
      'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3xx';

    // Try to record for address that is not storage admin and has no booking
    switchUser(STORAGE_ADMIN_ADDRESS);
    recordFileUpload(
      new Args().add(NOT_ALLOWED_ADDRESS).add<u64>(1_000_000_000).serialize(),
    );
  });

  throws('should fail to record upload with zero file size', () => {
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(5 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(5).serialize());

    switchUser(STORAGE_ADMIN_ADDRESS);
    recordFileUpload(new Args().add(UPLOADER_ADDRESS).add<u64>(0).serialize());
  });

  it('should track file uploads for two different uploaders independently', () => {
    const UPLOADER_A = UPLOADER_ADDRESS;
    const UPLOADER_B = 'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3ab';

    // User A books 3 GB
    switchUser(UPLOADER_A);
    mockBalance(UPLOADER_A, 10_000_000_000);
    mockTransferredCoins(3 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(3).serialize());

    // User B books 5 GB
    switchUser(UPLOADER_B);
    mockBalance(UPLOADER_B, 10_000_000_000);
    mockTransferredCoins(5 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(5).serialize());

    // Storage admin records uploads: user A uploads 100 MB + 400 MB; user B uploads 1 GB + 2 GB
    switchUser(STORAGE_ADMIN_ADDRESS);
    const fileA1: u64 = 100_000_000; // 100 MB
    const fileA2: u64 = 400_000_000; // 400 MB
    const fileB1: u64 = 1_000_000_000; // 1 GB
    const fileB2: u64 = 2_000_000_000; // 2 GB

    recordFileUpload(new Args().add(UPLOADER_A).add<u64>(fileA1).serialize());
    recordFileUpload(new Args().add(UPLOADER_B).add<u64>(fileB1).serialize());
    recordFileUpload(new Args().add(UPLOADER_A).add<u64>(fileA2).serialize());
    recordFileUpload(new Args().add(UPLOADER_B).add<u64>(fileB2).serialize());

    // Each uploader's usage is tracked independently
    const usageA = getUploaderUsageView(new Args().add(UPLOADER_A).serialize());
    const usageB = getUploaderUsageView(new Args().add(UPLOADER_B).serialize());
    expect(bytesToU64(usageA)).toBe(fileA1 + fileA2); // 500 MB
    expect(bytesToU64(usageB)).toBe(fileB1 + fileB2); // 3 GB

    // Booked amounts unchanged
    const bookedA = getBookedUploaderGbView(
      new Args().add(UPLOADER_A).serialize(),
    );
    const bookedB = getBookedUploaderGbView(
      new Args().add(UPLOADER_B).serialize(),
    );
    expect(bytesToU64(bookedA)).toBe(3);
    expect(bytesToU64(bookedB)).toBe(5);
  });

  it('should allow storage admin to remove file upload', () => {
    // Register uploader and record uploads
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(10 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(10).serialize());

    switchUser(STORAGE_ADMIN_ADDRESS);
    const fileSize: u64 = 2_000_000_000; // 2 GB
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(fileSize).serialize(),
    );

    // Remove the file
    removeFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(fileSize).serialize(),
    );

    // Verify usage is back to zero
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(0);
  });

  it('should prevent underflow when removing file upload', () => {
    // Register uploader
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(10 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(10).serialize());

    switchUser(STORAGE_ADMIN_ADDRESS);
    const fileSize: u64 = 1_000_000_000; // 1 GB
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(fileSize).serialize(),
    );

    // Try to remove more than was recorded (should prevent underflow)
    const largerSize: u64 = 2_000_000_000; // 2 GB
    removeFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(largerSize).serialize(),
    );

    // Usage should be 0, not negative
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(0);
  });

  it('should handle partial file removal correctly', () => {
    // Register uploader and record multiple uploads
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(10 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(10).serialize());

    switchUser(STORAGE_ADMIN_ADDRESS);
    const file1Size: u64 = 1_000_000_000; // 1 GB
    const file2Size: u64 = 2_000_000_000; // 2 GB
    const file3Size: u64 = 500_000_000; // 0.5 GB

    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file1Size).serialize(),
    );
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file2Size).serialize(),
    );
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file3Size).serialize(),
    );

    // Remove one file
    removeFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(file2Size).serialize(),
    );

    // Verify remaining usage
    const usageBytes = getUploaderUsageView(
      new Args().add(UPLOADER_ADDRESS).serialize(),
    );
    expect(bytesToU64(usageBytes)).toBe(file1Size + file3Size);
  });

  throws('should fail to remove file when caller is not storage admin', () => {
    // Register uploader and record upload
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(5 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(5).serialize());

    switchUser(STORAGE_ADMIN_ADDRESS);
    recordFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(1_000_000_000).serialize(),
    );

    // Try to remove as non-admin (should fail)
    switchUser(UPLOADER_ADDRESS);
    removeFileUpload(
      new Args().add(UPLOADER_ADDRESS).add<u64>(1_000_000_000).serialize(),
    );
  });

  throws('should fail to remove file with zero file size', () => {
    switchUser(UPLOADER_ADDRESS);
    mockBalance(UPLOADER_ADDRESS, 10_000_000_000);
    mockTransferredCoins(5 * DEFAULT_PRICE_PER_GB);
    registerAsUploader(new Args().add<u64>(5).serialize());

    switchUser(STORAGE_ADMIN_ADDRESS);
    removeFileUpload(new Args().add(UPLOADER_ADDRESS).add<u64>(0).serialize());
  });
});

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

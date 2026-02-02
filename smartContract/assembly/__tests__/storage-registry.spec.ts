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
  getTotalNodesCount,
  getConfigView,
  getNodeInfo,
  addChallenger,
  issueChallenge,
  fundContract,
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
  // Call stack format: caller , contract (last item is current execution context)
  changeCallStack(address + ' , ' + CONTRACT_ADDRESS);
}

function deployContract(): void {
  resetStorage();
  setDeployContext(ADMIN_ADDRESS);
  const constructorArgs = new Args().add(ADMIN_ADDRESS).serialize();
  constructor(constructorArgs);
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
  });
});

describe('Storage Registry - Node Registration', () => {
  beforeEach(() => {
    deployContract();
    // Give the contract some initial balance for operations
    mockBalance(CONTRACT_ADDRESS, 1_000_000_000_000);
  });

  it('should register a new storage node with valid stake', () => {
    switchUser(NODE_ADDRESS);
    // Mock sender's balance and transferred coins
    mockBalance(NODE_ADDRESS, 200_000_000_000);
    mockTransferredCoins(100_000_000_000);

    const args = new Args().add<u64>(10).serialize();
    registerStorageNode(args);

    // Verify node info
    const nodeInfoArgs = new Args().add(NODE_ADDRESS).serialize();
    const nodeBytes = getNodeInfo(nodeInfoArgs);
    const node = new StorageNode();
    node.deserialize(nodeBytes, 0);

    expect(node.allocatedGb).toBe(10);
    expect(node.active).toBe(true);
  });

  throws('should fail with insufficient stake', () => {
    switchUser(NODE_ADDRESS);
    mockBalance(NODE_ADDRESS, 200_000_000_000);
    mockTransferredCoins(1_000_000); // Only 0.001 MAS - insufficient

    const args = new Args().add<u64>(10).serialize();
    registerStorageNode(args);
  });

  throws('should fail with allocation below minimum', () => {
    switchUser(NODE_ADDRESS);
    mockBalance(NODE_ADDRESS, 200_000_000_000);
    mockTransferredCoins(100_000_000_000);

    const args = new Args().add<u64>(0).serialize(); // 0 GB - below minimum of 1
    registerStorageNode(args);
  });
});

describe('Storage Registry - Admin Functions', () => {
  beforeEach(() => {
    deployContract();
    mockBalance(CONTRACT_ADDRESS, 1_000_000_000_000);
  });

  it('should add challenger when called by admin', () => {
    switchUser(ADMIN_ADDRESS);
    mockBalance(ADMIN_ADDRESS, 1_000_000_000);
    const args = new Args().add(CHALLENGER_ADDRESS).serialize();
    addChallenger(args);
  });

  throws('should fail to add challenger when called by non-admin', () => {
    switchUser(NODE_ADDRESS);
    mockBalance(NODE_ADDRESS, 1_000_000_000);
    const args = new Args().add(CHALLENGER_ADDRESS).serialize();
    addChallenger(args);
  });
});

describe('Storage Registry - Challenge System', () => {
  beforeEach(() => {
    deployContract();
    mockBalance(CONTRACT_ADDRESS, 1_000_000_000_000);

    // Add challenger
    switchUser(ADMIN_ADDRESS);
    mockBalance(ADMIN_ADDRESS, 1_000_000_000);
    addChallenger(new Args().add(CHALLENGER_ADDRESS).serialize());

    // Register a node
    switchUser(NODE_ADDRESS);
    mockBalance(NODE_ADDRESS, 200_000_000_000);
    mockTransferredCoins(100_000_000_000);
    registerStorageNode(new Args().add<u64>(10).serialize());
  });

  it('should allow challenger to issue challenge', () => {
    switchUser(CHALLENGER_ADDRESS);
    mockBalance(CHALLENGER_ADDRESS, 1_000_000_000);
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

  throws('should fail when non-challenger issues challenge', () => {
    // Use a different address that is neither admin nor challenger
    const OTHER_ADDRESS = 'AU1mARGo8BjjFLbUTd3Fihs95EL8wwjPgcoHGzJTdQhQ14KPa3yh';
    switchUser(OTHER_ADDRESS);
    mockBalance(OTHER_ADDRESS, 1_000_000_000);
    const challengeArgs = new Args()
      .add('challenge_002')
      .add(NODE_ADDRESS)
      .add('chunk_xyz')
      .add<u64>(99999)
      .serialize();

    issueChallenge(challengeArgs);
  });
});

describe('Storage Registry - Fund Contract', () => {
  beforeEach(() => {
    deployContract();
    mockBalance(CONTRACT_ADDRESS, 1_000_000_000_000);
  });

  it('should accept funds from anyone', () => {
    switchUser(NODE_ADDRESS);
    mockBalance(NODE_ADDRESS, 10_000_000_000);
    mockTransferredCoins(1_000_000_000);
    fundContract(new StaticArray<u8>(0));
  });

  throws('should fail with zero coins', () => {
    switchUser(NODE_ADDRESS);
    mockBalance(NODE_ADDRESS, 10_000_000_000);
    mockTransferredCoins(0);
    fundContract(new StaticArray<u8>(0));
  });
});

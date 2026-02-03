import 'dotenv/config';
import {
  Account,
  Args,
  ArrayTypes,
  JsonRpcProvider,
  SmartContract,
} from '@massalabs/massa-web3';

/**
 * List registered storage providers and their metadata from the Storage Registry contract.
 *
 * Env variables:
 * - STORAGE_REGISTRY_ADDRESS: address of the deployed storage-registry contract (optional)
 *
 * If the contract exposes getRegisteredAddressesView(), all registered addresses are listed.
 * Otherwise set PROVIDER_ADDRESSES (comma-separated) to list specific addresses.
 */

const CONTRACT_ADDRESS =
  process.env.STORAGE_REGISTRY_ADDRESS ||
  'AS122kZ1ShKtZFJx8DDEp1BUQjUDCTaDBDwr27tGLYF5DmGzyyBAE';

const PROVIDER_ADDRESSES_ENV = (process.env.PROVIDER_ADDRESSES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const contract = new SmartContract(provider, CONTRACT_ADDRESS);

// Resolve list of addresses: from contract view or from env
let addresses: string[] = [];
if (PROVIDER_ADDRESSES_ENV.length > 0) {
  addresses = PROVIDER_ADDRESSES_ENV;
  console.log('Using PROVIDER_ADDRESSES from env:', addresses.length, 'address(es)\n');
} else {
  try {
    const viewResult = await contract.read('getRegisteredAddressesView', new Args());
    const raw = viewResult.value;
    if (raw && raw.length > 0) {
      const args = new Args(raw);
      addresses = args.nextArray<string>(ArrayTypes.STRING);
    }
  } catch (e) {
    console.warn('getRegisteredAddressesView not available or failed:', (e as Error).message);
    console.log('Set PROVIDER_ADDRESSES=addr1,addr2,... to list specific providers.\n');
    process.exit(0);
  }
  if (addresses.length === 0) {
    console.log('No registered providers (or contract has no index yet).');
    console.log('Set PROVIDER_ADDRESSES=addr1,addr2,... to list specific providers.\n');
    process.exit(0);
  }
  console.log('Registry contract:', CONTRACT_ADDRESS);
  console.log('Registered providers:', addresses.length, '\n');
}

interface NodeInfo {
  address: string;
  allocatedGb: bigint;
  registeredPeriod: bigint;
  totalChallenges: bigint;
  passedChallenges: bigint;
  pendingRewards: bigint;
  lastChallengedPeriod: bigint;
  lastRewardedPeriod: bigint;
  active: boolean;
}

interface ProviderMeta {
  endpoint: string;
  p2pAddrs: string[];
}

function deserializeNodeInfo(data: Uint8Array): NodeInfo {
  const args = new Args(data);
  return {
    address: args.nextString(),
    allocatedGb: args.nextU64(),
    registeredPeriod: args.nextU64(),
    totalChallenges: args.nextU64(),
    passedChallenges: args.nextU64(),
    pendingRewards: args.nextU64(),
    lastChallengedPeriod: args.nextU64(),
    lastRewardedPeriod: args.nextU64(),
    active: args.nextBool(),
  };
}

function deserializeProviderMeta(data: Uint8Array): ProviderMeta {
  const args = new Args(data);
  return {
    endpoint: args.nextString(),
    p2pAddrs: args.nextArray<string>(ArrayTypes.STRING),
  };
}

for (let i = 0; i < addresses.length; i++) {
  const addr = addresses[i];
  console.log('--- Provider', i + 1, ':', addr, '---');
  try {
    const nodeRes = await contract.read('getNodeInfo', new Args().addString(addr));
    const node = deserializeNodeInfo(nodeRes.value!);
    console.log('  Node: allocatedGb=', node.allocatedGb.toString(), 'active=', node.active);
    console.log('  Challenges: total=', node.totalChallenges.toString(), 'passed=', node.passedChallenges.toString());
    console.log('  Pending rewards:', node.pendingRewards.toString(), 'nanoMAS');
  } catch (e) {
    console.log('  Node: (not found or error)', (e as Error).message);
  }
  try {
    const metaRes = await contract.read('getProviderMetadataView', new Args().addString(addr));
    const meta = deserializeProviderMeta(metaRes.value!);
    console.log('  Endpoint:', meta.endpoint || '(none)');
    console.log('  P2P addrs:', meta.p2pAddrs.length ? meta.p2pAddrs.join(', ') : '(none)');
  } catch (e) {
    console.log('  Metadata: (not set or error)', (e as Error).message);
  }
  console.log('');
}

console.log('--- List complete ---');

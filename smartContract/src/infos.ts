/* eslint-disable max-len */
import 'dotenv/config';
import {
  Account,
  Args,
  ArrayTypes,
  formatMas,
  JsonRpcProvider,
  MAX_GAS_CALL,
  SmartContract,
} from '@massalabs/massa-web3';

/**
 * Display Storage Registry information:
 * - Registered storage providers and their metadata
 * - Uploader bookings and permissions
 * - Global storage usage statistics
 *
 * Env variables:
 * - STORAGE_REGISTRY_ADDRESS: address of the deployed storage-registry contract (required)
 * - PROVIDER_ADDRESSES: comma-separated list of provider addresses (optional; used if you
 *   want to inspect specific addresses instead of the contract's getRegisteredAddressesView())
 * - UPLOADER_ADDRESSES: comma-separated list of uploader addresses to inspect
 */

const CONTRACT_ADDRESS = process.env.STORAGE_REGISTRY_ADDRESS;
if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS.trim().length === 0) {
  console.error(
    'STORAGE_REGISTRY_ADDRESS is required. Set it in .env or the environment.',
  );
  process.exit(1);
}

const PROVIDER_ADDRESSES_ENV = (process.env.PROVIDER_ADDRESSES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const UPLOADER_ADDRESSES_ENV = (process.env.UPLOADER_ADDRESSES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const contract = new SmartContract(provider, CONTRACT_ADDRESS);

// ═══════════════════════════════════════════════════════════════════
// CONTRACT INFO
// ═══════════════════════════════════════════════════════════════════

console.log('=== SmartContract info ===');
console.log('  Contract address:', CONTRACT_ADDRESS);
console.log('  Admin address:', account.address.toString());
const contractBalance = await contract.balance(false);
console.log('  Contract balance :', formatMas(contractBalance), 'MAS');
console.log('');

// ═══════════════════════════════════════════════════════════════════
// TYPES & DESERIALIZERS
// ═══════════════════════════════════════════════════════════════════

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

interface GlobalUsage {
  totalAllocatedGb: bigint;
  totalBookedGb: bigint;
  availableGb: bigint;
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

function deserializeGlobalUsage(data: Uint8Array): GlobalUsage {
  const args = new Args(data);
  return {
    totalAllocatedGb: args.nextU64(),
    totalBookedGb: args.nextU64(),
    availableGb: args.nextU64(),
  };
}

function deserializeU64(data: Uint8Array): bigint {
  const args = new Args(data);
  return args.nextU64();
}

function deserializeBoolFromU64(data: Uint8Array): boolean {
  const value = deserializeU64(data);
  return value > 0n;
}

// ═══════════════════════════════════════════════════════════════════
// PROVIDERS
// ═══════════════════════════════════════════════════════════════════

// Resolve list of provider addresses: from contract view or from env
let providerAddresses: string[] = [];
if (PROVIDER_ADDRESSES_ENV.length > 0) {
  providerAddresses = PROVIDER_ADDRESSES_ENV;
  console.log(
    'Using PROVIDER_ADDRESSES from env:',
    providerAddresses.length,
    'address(es)\n',
  );
} else {
  try {
    const viewResult = await contract.read(
      'getRegisteredAddressesView',
      new Args(),
    );
    const raw = viewResult.value;
    if (raw && raw.length > 0) {
      const args = new Args(raw);
      providerAddresses = args.nextArray<string>(ArrayTypes.STRING);
    }
  } catch (e) {
    console.warn(
      'getRegisteredAddressesView not available or failed:',
      (e as Error).message,
    );
    console.log(
      'Set PROVIDER_ADDRESSES=addr1,addr2,... to list specific providers.\n',
    );
  }
}

if (providerAddresses.length > 0) {
  console.log('Registered providers:', providerAddresses.length, '\n');
  for (let i = 0; i < providerAddresses.length; i++) {
    const addr = providerAddresses[i];
    console.log('--- Provider', i + 1, ':', addr, '---');
    try {
      const nodeRes = await contract.read(
        'getNodeInfo',
        new Args().addString(addr),
      );
      if (nodeRes.value) {
        const node = deserializeNodeInfo(nodeRes.value);
        console.log(
          '  Node: allocatedGb=',
          node.allocatedGb.toString(),
          'active=',
          node.active,
        );
        console.log(
          '  Challenges: total=',
          node.totalChallenges.toString(),
          'passed=',
          node.passedChallenges.toString(),
        );
        console.log(
          '  Pending rewards:',
          formatMas(node.pendingRewards),
          'MAS',
        );
      } else {
        console.log('  Node: (no data)');
      }
    } catch (e) {
      console.log('  Node: (not found or error)', (e as Error).message);
    }
    try {
      const metaRes = await contract.read(
        'getProviderMetadataView',
        new Args().addString(addr),
      );
      if (metaRes.value) {
        const meta = deserializeProviderMeta(metaRes.value);
        console.log('  Endpoint:', meta.endpoint || '(none)');
        console.log(
          '  P2P addrs:',
          meta.p2pAddrs.length ? meta.p2pAddrs.join(', ') : '(none)',
        );
      } else {
        console.log('  Metadata: (no data)');
      }
    } catch (e) {
      console.log('  Metadata: (not set or error)', (e as Error).message);
    }
    console.log('');
  }
} else {
  console.log('No registered providers (or contract has no index yet).');
  console.log(
    'Set PROVIDER_ADDRESSES=addr1,addr2,... to list specific providers.\n',
  );
}

// ═══════════════════════════════════════════════════════════════════
// UPLOADERS
// ═══════════════════════════════════════════════════════════════════

if (UPLOADER_ADDRESSES_ENV.length > 0) {
  console.log(
    'Registered uploaders to inspect:',
    UPLOADER_ADDRESSES_ENV.length,
  );
  console.log('');

  for (let i = 0; i < UPLOADER_ADDRESSES_ENV.length; i++) {
    const addr = UPLOADER_ADDRESSES_ENV[i];
    console.log('--- Uploader', i + 1, ':', addr, '---');

    try {
      const bookedRes = await contract.read(
        'getBookedUploaderGbView',
        new Args().addString(addr),
      );
      const bookedGb = bookedRes.value
        ? deserializeU64(bookedRes.value).toString()
        : '0';
      console.log('  Booked capacity:', bookedGb, 'GB');
    } catch (e) {
      console.log(
        '  Booked capacity: (error reading getBookedUploaderGbView)',
        (e as Error).message,
      );
    }

    try {
      const isAdminRes = await contract.read(
        'getIsStorageAdmin',
        new Args().addString(addr),
      );
      const isAdmin =
        isAdminRes.value && deserializeBoolFromU64(isAdminRes.value);
      console.log('  Is storage admin:', isAdmin);
    } catch (e) {
      console.log(
        '  Is storage admin: (error reading getIsStorageAdmin)',
        (e as Error).message,
      );
    }

    try {
      const isAllowedRes = await contract.read(
        'getIsAllowedUploader',
        new Args().addString(addr),
      );
      const isAllowed =
        isAllowedRes.value && deserializeBoolFromU64(isAllowedRes.value);
      console.log('  Is allowed uploader:', isAllowed);
    } catch (e) {
      console.log(
        '  Is allowed uploader: (error reading getIsAllowedUploader)',
        (e as Error).message,
      );
    }

    console.log('');
  }
} else {
  console.log('No UPLOADER_ADDRESSES set.');
  console.log(
    'Note: the contract does not expose a public uploader index, so this script cannot automatically enumerate uploaders even if storage is fully booked.',
  );
  console.log(
    'To inspect specific uploaders, set UPLOADER_ADDRESSES=addr1,addr2,... in your environment.\n',
  );
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL USAGE
// ═══════════════════════════════════════════════════════════════════

try {
  const usageRes = await contract.read('getGlobalStorageUsageView', new Args());
  if (usageRes.value) {
    const usage = deserializeGlobalUsage(usageRes.value);
    const { totalAllocatedGb, totalBookedGb, availableGb } = usage;

    let utilizationPct = '0';
    if (totalAllocatedGb > 0n) {
      // percentage with two decimals: (booked / total) * 100
      const scaled = (totalBookedGb * 10000n) / totalAllocatedGb;
      const intPart = scaled / 100n;
      const fracPart = scaled % 100n;
      utilizationPct = `${intPart.toString()}.${fracPart
        .toString()
        .padStart(2, '0')}`;
    }

    console.log('=== Global storage usage ===');
    console.log(
      '  Total provider capacity:',
      totalAllocatedGb.toString(),
      'GB',
    );
    console.log('  Total booked by uploaders:', totalBookedGb.toString(), 'GB');
    console.log('  Available capacity:', availableGb.toString(), 'GB');
    console.log('  Utilization:', utilizationPct, '%');
  } else {
    console.log('Global usage: (no data)');
  }
} catch (e) {
  console.log(
    'Global usage: view getGlobalStorageUsageView failed or not available',
    (e as Error).message,
  );
}

console.log('--- Infos complete ---');

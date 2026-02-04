import 'dotenv/config';
import {
  Account,
  Args,
  ArrayTypes,
  JsonRpcProvider,
  Operation,
  SmartContract,
} from '@massalabs/massa-web3';

/**
 * Register a new storage provider in the Storage Registry contract
 * and publish its metadata (HTTP endpoint + P2P multiaddrs).
 *
 * Required env variables:
 * - STORAGE_REGISTRY_ADDRESS: address of the deployed storage-registry contract
 * - PROVIDER_ENDPOINT: HTTP base URL of the running storage server (e.g. "http://127.0.0.1:4343")
 *
 * Optional:
 * - PROVIDER_P2P_ADDRS: comma-separated libp2p multiaddrs
 *
 * ALLOCATED_GB is retrieved from the running server via GET \{PROVIDER_ENDPOINT\}/config
 * (storage_limit_gb). The server must be reachable when running this script.
 *
 * The Massa address used is the one loaded from Account.fromEnv()
 * (MASSA_PRIVATE_KEY / WALLET env as configured for massa-web3).
 */

const CONTRACT_ADDRESS = process.env.STORAGE_REGISTRY_ADDRESS;
if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS.trim().length === 0) {
  console.error(
    'STORAGE_REGISTRY_ADDRESS is required. Set it in .env or the environment.',
  );
  process.exit(1);
}

const ENDPOINT = process.env.PROVIDER_ENDPOINT || '';
if (!ENDPOINT) {
  console.error('PROVIDER_ENDPOINT is required (e.g. http://127.0.0.1:4343)');
  process.exit(1);
}

const P2P_ADDRS: string[] = (process.env.PROVIDER_P2P_ADDRS || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Retrieve storage_limit_gb from the running provider's GET /config
const configUrl = `${ENDPOINT.replace(/\/$/, '')}/config`;
console.log('Fetching provider config from', configUrl);
const configRes = await fetch(configUrl);
if (!configRes.ok) {
  console.error(
    'Failed to fetch provider config:',
    configRes.status,
    await configRes.text(),
  );
  process.exit(1);
}
const config = (await configRes.json()) as {
  storage_limit_gb: number;
  storage_limit_bytes: number;
  storage_used_bytes: number;
};
const ALLOCATED_GB = BigInt(config.storage_limit_gb);
if (ALLOCATED_GB <= 0n) {
  console.error(
    'Provider reported storage_limit_gb <= 0:',
    config.storage_limit_gb,
  );
  process.exit(1);
}

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const contract = new SmartContract(provider, CONTRACT_ADDRESS);

console.log('Registering storage provider...');
console.log('Registry contract:', CONTRACT_ADDRESS);
console.log('Provider address:', account.address.toString());
console.log('Allocated GB (from provider /config):', ALLOCATED_GB.toString());
console.log('Endpoint:', ENDPOINT);
console.log('P2P addrs:', P2P_ADDRS.length ? P2P_ADDRS : '(none)');

// 1. Register or update: if node already registered, update allocation; otherwise register
//    with initial metadata (endpoint + P2P addresses).
const myAddress = account.address.toString();

const nodeInfo = await contract.read(
  'getNodeInfo',
  new Args().addString(myAddress),
);

const nodeExists = !nodeInfo.info.error && nodeInfo.value.length > 0;

let operation: Operation;
if (nodeExists) {
  const updateArgs = new Args().addU64(ALLOCATED_GB);
  operation = await contract.call('updateStorageAllocation', updateArgs);
  console.log(
    'updateStorageAllocation call sent (node already registered). Operation id:',
    operation.id,
  );
} else {
  const registerArgs = new Args()
    .addU64(ALLOCATED_GB)
    .addString(ENDPOINT)
    .addArray(P2P_ADDRS, ArrayTypes.STRING);
  operation = await contract.call('registerStorageNode', registerArgs);
  console.log(
    'registerStorageNode (with metadata) call sent. Operation id:',
    operation.id,
  );
}

await operation.waitFinalExecution();
console.log('Operation finalized:', operation.id);

console.log('\n--- Provider registration script complete ---');

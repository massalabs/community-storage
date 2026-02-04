import 'dotenv/config';
import {
  Account,
  Args,
  ArrayTypes,
  JsonRpcProvider,
  SmartContract,
} from '@massalabs/massa-web3';

/**
 * Update P2P addresses for a provider by fetching them from the server's /peers endpoint.
 *
 * Usage: PROVIDER_ENDPOINT=http://localhost:4343 WALLET_SECRET_KEY=... npx ts-node src/update-p2p-addrs.ts
 */

const CONTRACT_ADDRESS = process.env.STORAGE_REGISTRY_ADDRESS;
if (!CONTRACT_ADDRESS) {
  console.error('STORAGE_REGISTRY_ADDRESS is required');
  process.exit(1);
}

const ENDPOINT = process.env.PROVIDER_ENDPOINT || '';
if (!ENDPOINT) {
  console.error('PROVIDER_ENDPOINT is required');
  process.exit(1);
}

// Fetch P2P multiaddrs from the running server
const peersUrl = `${ENDPOINT.replace(/\/$/, '')}/peers`;
const peersRes = await fetch(peersUrl);
if (!peersRes.ok) {
  console.error('Failed to fetch /peers:', peersRes.status);
  process.exit(1);
}

const peers = (await peersRes.json()) as {
  local_peer_id: string;
  multiaddrs: string[];
};

// Filter to only public addresses (exclude 127.0.0.1 and 172.x.x.x)
const publicAddrs = peers.multiaddrs.filter((addr) => {
  return (
    !addr.includes('/ip4/127.') &&
    !addr.includes('/ip4/172.') &&
    !addr.includes('/ip4/10.')
  );
});

console.log('Server:', ENDPOINT);
console.log('PeerID:', peers.local_peer_id);
console.log(
  'Public multiaddrs:',
  publicAddrs.length ? publicAddrs : '(none - using all)',
);

const addrsToRegister = publicAddrs.length > 0 ? publicAddrs : peers.multiaddrs;

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const contract = new SmartContract(provider, CONTRACT_ADDRESS);

// Update provider metadata
const metaArgs = new Args()
  .addString(ENDPOINT)
  .addArray(addrsToRegister, ArrayTypes.STRING);

const op = await contract.call('updateProviderMetadata', metaArgs);
console.log('updateProviderMetadata sent:', op.id);

await op.waitSpeculativeExecution();
console.log('Done. P2P addresses registered:', addrsToRegister);

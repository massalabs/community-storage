/**
 * Provider Setup Script
 * Usage: npm run setup | npm run setup status
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  Account,
  Args,
  JsonRpcProvider,
  SmartContract,
  Mas,
} from '@massalabs/massa-web3';

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

dotenv.config({ path: ENV_PATH });

const config = {
  contract:
    process.env.STORAGE_REGISTRY_ADDRESS ||
    'AS14XRdSCc87DZbMx2Zwa1BWK2R8WmwShFGnTtVa2RLDYyx2vwyn',
  numProviders: parseInt(process.env.NUM_PROVIDERS || '3', 10),
  storageGb: BigInt(process.env.STORAGE_LIMIT_GB || '1'),
  fundAmount: Mas.fromString('5'),
  basePort: 4343,
};

// -----------------------------------------------------------------------------
// Types & Helpers
// -----------------------------------------------------------------------------

interface Provider {
  index: number;
  address: string;
  privateKey: string;
}

function appendToEnv(key: string, value: string): void {
  fs.appendFileSync(ENV_PATH, `${key}=${value}\n`);
  process.env[key] = value;
}

async function loadProviders(generateMissing = false): Promise<Provider[]> {
  const providers: Provider[] = [];

  for (let i = 1; i <= config.numProviders; i++) {
    const addrKey = `PROVIDER_${i}_ADDRESS`;
    const keyKey = `PROVIDER_${i}_PRIVATE_KEY`;
    const addr = process.env[addrKey];
    const key = process.env[keyKey];

    if (addr && key) {
      providers.push({ index: i, address: addr, privateKey: key });
    } else if (generateMissing) {
      console.log(`Provider ${i}: Generating keypair...`);
      const account = await Account.generate();
      appendToEnv(addrKey, account.address.toString());
      appendToEnv(keyKey, account.privateKey.toString());
      providers.push({
        index: i,
        address: account.address.toString(),
        privateKey: account.privateKey.toString(),
      });
    }
  }
  return providers;
}

async function isRegistered(
  contract: SmartContract,
  address: string,
): Promise<boolean> {
  try {
    const res = await contract.read(
      'getNodeInfo',
      new Args().addString(address),
    );
    return !res.info.error && res.value.length > 0;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

async function showStatus(): Promise<void> {
  console.log('=== Status ===\n');

  const funder = await Account.fromEnv();
  const rpc = JsonRpcProvider.buildnet(funder);
  const contract = new SmartContract(rpc, config.contract);

  const [funderBal] = await rpc.balanceOf([funder.address.toString()], false);
  console.log(`Funder:  ${funder.address}`);
  console.log(`Balance: ${Mas.toString(funderBal.balance)} MAS\n`);

  const providers = await loadProviders();
  for (const p of providers) {
    const [bal] = await rpc.balanceOf([p.address], false);
    const reg = await isRegistered(contract, p.address);
    console.log(
      `Provider ${p.index}: ${Mas.toString(bal.balance)} MAS | ${
        reg ? 'registered' : 'not registered'
      }`,
    );
  }
}

async function runSetup(): Promise<void> {
  console.log('=== Provider Setup ===\n');
  console.log(`Contract:  ${config.contract}`);
  console.log(`Providers: ${config.numProviders}\n`);

  const funder = await Account.fromEnv();
  const funderRpc = JsonRpcProvider.buildnet(funder);
  const [funderBal] = await funderRpc.balanceOf([funder.address.toString()]);
  console.log(`Funder: ${Mas.toString(funderBal.balance)} MAS\n`);

  const providers = await loadProviders(true);

  // Fund sequentially
  console.log('--- Funding ---');
  for (const p of providers) {
    const [bal] = await funderRpc.balanceOf([p.address], false);
    if (bal.balance >= config.fundAmount) {
      console.log(`Provider ${p.index}: ${Mas.toString(bal.balance)} MAS (OK)`);
      continue;
    }
    console.log(`Provider ${p.index}: Sending 5 MAS...`);
    const op = await funderRpc.transfer(p.address, config.fundAmount);
    await op.waitSpeculativeExecution();
  }

  // Register sequentially
  console.log('\n--- Registering ---');
  for (const p of providers) {
    const endpoint = `http://localhost:${config.basePort + p.index - 1}`;
    try {
      const account = await Account.fromPrivateKey(p.privateKey);
      const rpc = JsonRpcProvider.buildnet(account);
      const contract = new SmartContract(rpc, config.contract);

      if (await isRegistered(contract, p.address)) {
        console.log(`Provider ${p.index}: Updating...`);
        const op = await contract.call(
          'updateStorageAllocation',
          new Args().addU64(config.storageGb),
        );
        await op.waitSpeculativeExecution();
      } else {
        console.log(`Provider ${p.index}: Registering...`);
        const op = await contract.call(
          'registerStorageNode',
          new Args().addU64(config.storageGb),
        );
        await op.waitSpeculativeExecution();
      }

      const metaOp = await contract.call(
        'updateProviderMetadata',
        new Args().addString(endpoint).addArray([], 0),
      );
      await metaOp.waitSpeculativeExecution();
      console.log(`Provider ${p.index}: OK -> ${endpoint}`);
    } catch (e) {
      console.error(`Provider ${p.index}: FAILED - ${(e as Error).message}`);
    }
  }

  console.log('\n=== Done ===');
  console.log(
    `\nStart servers: cd ../server && ./scripts/setup.sh ${config.numProviders}`,
  );
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

const command = process.argv[2] || 'setup';
if (command === 'status') {
  showStatus().catch(console.error);
} else {
  runSetup().catch(console.error);
}

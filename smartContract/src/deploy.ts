import 'dotenv/config';
import {
  Account,
  Args,
  Mas,
  SmartContract,
  JsonRpcProvider,
} from '@massalabs/massa-web3';
import { getScByteCode } from './utils';

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);

console.log('Deploying Storage Registry contract...');
console.log('Deployer address:', account.address.toString());

const byteCode = getScByteCode('build', 'storage-registry.wasm');

// Constructor arguments
const adminAddress = account.address.toString();

// Optional: Custom config (uncomment and modify as needed)
// const config = {
//   rewardPerGbPerPeriod: 1_000_000n,      // 0.001 MAS
//   minAllocatedGb: 1n,
//   maxAllocatedGb: 1000n,
//   challengeResponseTimeout: 60_000n,     // 1 minute
//   slashPercentage: 10n,
//   minStake: 100_000_000_000n,            // 100 MAS
//   rewardDistributionPeriod: 100n,
// };

const constructorArgs = new Args().addString(adminAddress);
// To include custom config, serialize and add it:
// constructorArgs.addSerializable(config);

const contract = await SmartContract.deploy(
  provider,
  byteCode,
  constructorArgs,
  {
    coins: Mas.fromString('1'), // Initial funding for storage costs
    maxGas: 4_000_000_000n,
  },
);

console.log('Contract deployed at:', contract.address);

const events = await provider.getEvents({
  smartContractAddress: contract.address,
});

for (const event of events) {
  console.log('Event:', event.data);
}

console.log('\n--- Deployment Complete ---');
console.log('Contract Address:', contract.address);
console.log('Admin Address:', adminAddress);
console.log('\nNext steps:');
console.log('1. Fund the contract with MAS for rewards');
console.log('2. Add challenger addresses (protocol nodes)');
console.log('3. Configure the contract address in massa-node config');

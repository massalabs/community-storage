import 'dotenv/config';
import {
  Account,
  Args,
  formatMas,
  JsonRpcProvider,
  SmartContract,
} from '@massalabs/massa-web3';

/**
 * Book storage capacity to become an allowed uploader. Pays the contract
 * amountGb × uploaderPricePerGb (nanoMAS). After this, the storage server
 * will accept uploads from this address (getIsAllowedUploader returns true).
 *
 * Usage:
 *   npx tsx src/register-uploader.ts [amountGb]
 *
 * Environment:
 *   STORAGE_REGISTRY_ADDRESS — contract address (required)
 *   PRIVATE_KEY / WALLET — signer (required)
 *
 * Example:
 *   npx tsx src/register-uploader.ts 10
 *   AMOUNT_GB=5 npx tsx src/register-uploader.ts
 */

const CONTRACT_ADDRESS =
  process.env.STORAGE_REGISTRY_ADDRESS ||
  'AS122kZ1ShKtZFJx8DDEp1BUQjUDCTaDBDwr27tGLYF5DmGzyyBAE';

const amountGbArg = process.argv[2] || process.env.AMOUNT_GB;
if (!amountGbArg) {
  console.error('Usage: npx tsx src/register-uploader.ts <amountGb>');
  console.error('   or set AMOUNT_GB in env');
  process.exit(1);
}

const amountGb = BigInt(amountGbArg);
if (amountGb <= 0n) {
  console.error('amountGb must be >= 1');
  process.exit(1);
}

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);
const contract = new SmartContract(provider, CONTRACT_ADDRESS);

// Read current price per GB (nanoMAS)
const priceResult = await contract.read(
  'getUploaderPricePerGbView',
  new Args(),
);
if (priceResult.info?.error) {
  console.error('Failed to read price:', priceResult.info.error);
  process.exit(1);
}
const pricePerGb =
  priceResult.value && priceResult.value.length >= 8
    ? new DataView(priceResult.value.buffer).getBigUint64(0, true)
    : 0n;

const requiredNano = amountGb * pricePerGb;
// Coins are passed in smallest unit (nanoMAS)

console.log('Storage Registry:', CONTRACT_ADDRESS);
console.log('Booking:', amountGb.toString(), 'GB');
console.log('Price per GB:', formatMas(pricePerGb), 'MAS');
console.log('Required payment:', formatMas(requiredNano), 'MAS');
console.log('Caller:', account.address.toString());

const args = new Args().addU64(amountGb);
const op = await contract.call('registerAsUploader', args, {
  coins: requiredNano,
});

console.log('Operation sent. Id:', op.id);
await op.waitFinalExecution();
console.log(
  'Finalized. You are now an allowed uploader for',
  amountGb.toString(),
  'GB.',
);
console.log(
  'Use upload-file.ts with PRIVATE_KEY set to upload files to the storage server.',
);

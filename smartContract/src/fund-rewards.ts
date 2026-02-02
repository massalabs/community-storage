import 'dotenv/config';
import { Account, Mas, JsonRpcProvider } from '@massalabs/massa-web3';

const CONTRACT_ADDRESS =
  process.env.STORAGE_REGISTRY_ADDRESS ||
  'AS1V8vQxhL1q2c6fZJ8pGhU51eZiSLSNAwRojbmvVKWDaKbnsHk6';

const REWARDS_AMOUNT_MAS = process.env.REWARDS_AMOUNT_MAS || '1000';

const account = await Account.fromEnv();
const provider = JsonRpcProvider.buildnet(account);

console.log('Funding Storage Registry contract with rewards...');
console.log('Contract:', CONTRACT_ADDRESS);
console.log('Amount:', REWARDS_AMOUNT_MAS, 'MAS');
console.log('Sender:', account.address.toString());

const amount = Mas.fromString(REWARDS_AMOUNT_MAS);
const op = await provider.transfer(CONTRACT_ADDRESS, amount);

console.log('Transfer operation sent. Op id:', op.operationId);
console.log('Wait for finalization on buildnet, then check contract balance.');

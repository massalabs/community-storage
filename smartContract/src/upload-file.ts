import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Account } from '@massalabs/massa-web3';

/**
 * Upload a file to a storage provider's HTTP API (POST /upload).
 * When the server requires auth, set PRIVATE_KEY (or WALLET) so the client signs the body
 * and sends X-Massa-Address, X-Massa-Signature, X-Massa-Public-Key. The server verifies
 * the signature and checks getIsStorageAdmin(address) on the storage registry contract.
 *
 * Usage:
 *   npx tsx src/upload-file.ts <file-path>
 *
 * Environment (optional):
 *   PROVIDER_ENDPOINT — base URL of the storage server (default: http://127.0.0.1:4343)
 *   UPLOAD_NAMESPACE  — namespace (default: default)
 *   UPLOAD_ID         — optional id (server generates UUID if omitted)
 *   MIN_REPLICATION   — minimum replicas 1–32 (default: 1)
 *   PRIVATE_KEY / WALLET — Massa secret key for signing (required when server has upload auth)
 *
 * Example:
 *   PROVIDER_ENDPOINT=http://127.0.0.1:4343 npx tsx src/upload-file.ts ./myfile.bin
 *   npx tsx src/upload-file.ts ./data.json --namespace=blockchain --id=snapshot_1
 */

const PROVIDER_ENDPOINT =
  process.env.PROVIDER_ENDPOINT || 'http://127.0.0.1:4343';
const DEFAULT_NAMESPACE = process.env.UPLOAD_NAMESPACE || 'default';
const DEFAULT_ID = process.env.UPLOAD_ID || undefined;
const MIN_REPLICATION = process.env.MIN_REPLICATION
  ? parseInt(process.env.MIN_REPLICATION, 10)
  : 1;

function parseArgs(): {
  filePath: string;
  namespace: string;
  id: string | undefined;
  minReplication: number;
  } {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));
  if (!filePath) {
    console.error(
      'Usage: npx tsx src/upload-file.ts <file-path> [--namespace=...] [--id=...] [--min-replication=N]',
    );
    process.exit(1);
  }
  let namespace = DEFAULT_NAMESPACE;
  let id = DEFAULT_ID;
  let minReplication = MIN_REPLICATION;
  for (const arg of args) {
    if (arg.startsWith('--namespace='))
      namespace = arg.slice('--namespace='.length);
    if (arg.startsWith('--id=')) id = arg.slice('--id='.length) || undefined;
    if (arg.startsWith('--min-replication=')) {
      minReplication = parseInt(arg.slice('--min-replication='.length), 10);
    }
  }
  return { filePath, namespace, id, minReplication };
}

async function main(): Promise<void> {
  const { filePath, namespace, id, minReplication } = parseArgs();

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    console.error('Not a file:', resolved);
    process.exit(1);
  }

  const body = fs.readFileSync(resolved);
  const base = PROVIDER_ENDPOINT.replace(/\/$/, '');
  const url = new URL(`${base}/upload`);
  url.searchParams.set('namespace', namespace);
  if (id) url.searchParams.set('id', id);
  if (minReplication > 1)
    url.searchParams.set('min_replication', String(minReplication));

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };

  if (!process.env.PRIVATE_KEY) {
    console.error('PRIVATE_KEY is not set');
    process.exit(1);
  }

  const account = await Account.fromEnv();
  const signature = await account.sign(new Uint8Array(body));
  headers['X-Massa-Address'] = account.address.toString();
  headers['X-Massa-Signature'] = signature.toString();
  headers['X-Massa-Public-Key'] = account.publicKey.toString();
  console.log('Signing as', account.address.toString());
  console.log('Signature:', signature.toString());
  console.log('Public Key:', account.publicKey.toString());

  console.log('Uploading to', url.toString());
  console.log('File:', resolved, 'size:', body.length, 'bytes');

  const res = await fetch(url.toString(), {
    method: 'POST',
    body,
    headers,
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('Upload failed:', res.status, text);
    process.exit(1);
  }

  let json: {
    id?: string;
    namespace?: string;
    min_replication?: number;
    error?: string;
  };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    console.log('Response:', text);
    return;
  }

  if (json.error) {
    console.error('Error:', json.error);
    process.exit(1);
  }

  console.log('Upload OK:', json);
  console.log('  id:', json.id);
  console.log('  namespace:', json.namespace);
  if (json.min_replication != null)
    console.log('  min_replication:', json.min_replication);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

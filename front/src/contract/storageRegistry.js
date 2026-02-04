/**
 * Client de lecture du smart contract Storage Registry (buildnet).
 * Utilise JsonRpcPublicProvider pour les appels read-only sans wallet.
 */
import {
  Args,
  ArrayTypes,
  JsonRpcPublicProvider,
  PublicAPI,
  PublicApiUrl,
  SmartContract,
} from "@massalabs/massa-web3";

const CONTRACT_ADDRESS =
  import.meta.env.VITE_STORAGE_REGISTRY_ADDRESS ||
  "AS14XRdSCc87DZbMx2Zwa1BWK2R8WmwShFGnTtVa2RLDYyx2vwyn";

let provider = null;
let contract = null;
let publicApi = null;

function getContract() {
  if (!contract) {
    provider = JsonRpcPublicProvider.buildnet();
    contract = new SmartContract(provider, CONTRACT_ADDRESS);
  }
  return contract;
}

/**
 * Période courante sur la chaîne (buildnet).
 * @returns {Promise<number>}
 */
export async function getCurrentPeriod() {
  if (!publicApi) publicApi = new PublicAPI(PublicApiUrl.Buildnet);
  return publicApi.fetchPeriod();
}

/**
 * Lit la configuration du contrat (StorageConfig).
 * Le contrat expose 5 champs : rewardPerGbPerPeriod, minAllocatedGb, maxAllocatedGb, challengeResponseTimeout, rewardDistributionPeriod.
 * @returns {Promise<{ rewardPerGbPerPeriod, minAllocatedGb, maxAllocatedGb, challengeResponseTimeout, rewardDistributionPeriod }>}
 */
export async function getConfig() {
  const sc = getContract();
  const res = await sc.read("getConfigView", new Args());
  if (res.info?.error) throw new Error(res.info.error);
  const args = new Args(res.value);
  return {
    rewardPerGbPerPeriod: args.nextU64(),
    minAllocatedGb: args.nextU64(),
    maxAllocatedGb: args.nextU64(),
    challengeResponseTimeout: args.nextU64(),
    rewardDistributionPeriod: args.nextU64(),
  };
}

/**
 * Lit le nombre total de nœuds enregistrés.
 * @returns {Promise<bigint>}
 */
export async function getTotalNodes() {
  const sc = getContract();
  const res = await sc.read("getTotalNodesCount", new Args());
  if (res.info?.error) throw new Error(res.info.error);
  const args = new Args(res.value);
  return args.nextU64();
}

/**
 * Lit les stats d'une période (PeriodStats).
 * @param {number|bigint} period - Numéro de période
 * @returns {Promise<{ period, totalGbStored, totalRewardsDistributed, activeNodes, challengesIssued, challengesPassed, rewardsDistributed }>}
 */
export async function getPeriodStats(period) {
  const sc = getContract();
  const args = new Args().addU64(BigInt(period));
  const res = await sc.read("getPeriodStatsView", args);
  if (res.info?.error) throw new Error(res.info.error);
  const out = new Args(res.value);
  return {
    period: out.nextU64(),
    totalGbStored: out.nextU64(),
    totalRewardsDistributed: out.nextU64(),
    activeNodes: out.nextU64(),
    challengesIssued: out.nextU64(),
    challengesPassed: out.nextU64(),
    rewardsDistributed: out.nextBool(),
  };
}

/**
 * Lit les infos d'un nœud de stockage (StorageNode).
 * @param {string} address - Adresse du nœud
 * @returns {Promise<{ address, allocatedGb, registeredPeriod, totalChallenges, passedChallenges, pendingRewards, lastChallengedPeriod, stakedAmount, active } | null>} null si non enregistré
 */
export async function getNodeInfo(address) {
  const sc = getContract();
  const args = new Args().addString(address);
  const res = await sc.read("getNodeInfo", args);
  if (res.info?.error) return null;
  const out = new Args(res.value);
  return {
    address: out.nextString(),
    allocatedGb: out.nextU64(),
    registeredPeriod: out.nextU64(),
    totalChallenges: out.nextU64(),
    passedChallenges: out.nextU64(),
    pendingRewards: out.nextU64(),
    lastChallengedPeriod: out.nextU64(),
    stakedAmount: out.nextU64(),
    active: out.nextBool(),
  };
}

/**
 * Récompenses en attente pour une adresse (nanoMAS).
 * @param {string} address
 * @returns {Promise<bigint>}
 */
export async function calculatePendingRewards(address) {
  const sc = getContract();
  const args = new Args().addString(address);
  const res = await sc.read("calculatePendingRewards", args);
  if (res.info?.error) throw new Error(res.info.error);
  const out = new Args(res.value);
  return out.nextU64();
}

/**
 * Balance du contrat (nanoMAS). Pour l’admin : MAS déposés sur le contrat.
 * @param {boolean} [final=true]
 * @returns {Promise<bigint>}
 */
export async function getContractBalance(final = true) {
  const sc = getContract();
  return sc.balance(final);
}

/**
 * Lit l'adresse d'un nœud par index (pour lister les providers).
 * @param {number|bigint} index - Index (0 à totalNodes - 1)
 * @returns {Promise<string>} Adresse ou '' si hors limites
 */
export async function getNodeAddressAt(index) {
  const sc = getContract();
  const args = new Args().addU64(BigInt(index));
  const res = await sc.read("getNodeAddressAt", args);
  if (res.info?.error) return "";
  const out = new Args(res.value);
  return out.nextString() || "";
}

/**
 * Récupère la liste des adresses enregistrées via getRegisteredAddressesView (un seul appel RPC).
 * @returns {Promise<string[]>} Tableau d'adresses, ou [] si la vue n'existe pas / échec
 */
export async function getRegisteredAddresses() {
  try {
    const sc = getContract();
    const res = await sc.read("getRegisteredAddressesView", new Args());
    if (res.info?.error || !res.value || res.value.length === 0) return [];
    const args = new Args(res.value);
    const arr = args.nextArray(ArrayTypes.STRING);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

/**
 * Vérifie si une adresse est autorisée à uploader (admin ou a réservé du stockage).
 * @param {string} address - Adresse Massa
 * @returns {Promise<boolean>}
 */
export async function getIsAllowedUploader(address) {
  try {
    const sc = getContract()
    const args = new Args().addString(address)
    const res = await sc.read('getIsAllowedUploader', args)
    if (res.info?.error || !res.value || res.value.length < 8) return false
    const out = new Args(res.value)
    const n = out.nextU64()
    return n === 1n
  } catch (_) {
    return false
  }
}

/**
 * Nombre de GB réservés par une adresse (registerAsUploader).
 * @param {string} address - Adresse Massa
 * @returns {Promise<bigint>}
 */
export async function getBookedUploaderGb(address) {
  try {
    const sc = getContract()
    const args = new Args().addString(address)
    const res = await sc.read('getBookedUploaderGbView', args)
    if (res.info?.error || !res.value || res.value.length < 8) return 0n
    const out = new Args(res.value)
    return out.nextU64()
  } catch (_) {
    return 0n
  }
}

/**
 * Prix par GB pour réserver en tant qu'uploader (nanoMAS).
 * @returns {Promise<bigint>}
 */
export async function getUploaderPricePerGb() {
  try {
    const sc = getContract()
    const res = await sc.read('getUploaderPricePerGbView', new Args())
    if (res.info?.error || !res.value || res.value.length < 8) return 0n
    const out = new Args(res.value)
    return out.nextU64()
  } catch (_) {
    return 0n
  }
}

/**
 * Récupère les métadonnées d'un provider (endpoint HTTP + adresses P2P) depuis le contrat.
 * Permet de savoir où envoyer les fichiers pour hébergement (massa-storage-server).
 * @param {string} address - Adresse du provider
 * @returns {Promise<{ endpoint: string, p2pAddrs: string[] }>}
 */
export async function getProviderMetadata(address) {
  try {
    const sc = getContract();
    const args = new Args().addString(address);
    const res = await sc.read("getProviderMetadataView", args);
    if (res.info?.error || !res.value || res.value.length === 0) {
      return { endpoint: "", p2pAddrs: [] };
    }
    const out = new Args(res.value);
    const endpoint = out.nextString() || "";
    const p2pAddrs = out.nextArray(ArrayTypes.STRING) || [];
    return { endpoint, p2pAddrs: Array.isArray(p2pAddrs) ? p2pAddrs : [] };
  } catch (_) {
    return { endpoint: "", p2pAddrs: [] };
  }
}

/**
 * Liste des providers avec place dispo et métadonnées (version réelle : lit la liste on-chain).
 * Chaque item : { address, allocatedGb, usedGb?, availableGb, endpoint?, p2pAddrs? }.
 * endpoint = URL HTTP du massa-storage-server pour héberger les fichiers ; p2pAddrs = multiaddrs libp2p.
 * @returns {Promise<Array<{ address, allocatedGb, usedGb?, availableGb, endpoint?, p2pAddrs? }>>}
 */
export async function getStorageProviders() {
  let addresses = await getRegisteredAddresses();
  if (addresses.length === 0) {
    const total = await getTotalNodes();
    const n = Number(total);
    for (let i = 0; i < n; i++) {
      const addr = await getNodeAddressAt(i);
      if (addr) addresses.push(addr);
    }
  }
  const list = [];
  for (const address of addresses) {
    const info = await getNodeInfo(address);
    if (!info || !info.active) continue;
    const allocatedGb = info.allocatedGb;
    const usedGb = info.usedGb != null ? info.usedGb : 0n;
    const availableGb = allocatedGb - usedGb;
    const metadata = await getProviderMetadata(address);
    list.push({
      address,
      allocatedGb,
      usedGb,
      availableGb: availableGb > 0n ? availableGb : allocatedGb,
      endpoint: metadata.endpoint || undefined,
      p2pAddrs: metadata.p2pAddrs?.length ? metadata.p2pAddrs : undefined,
    });
  }
  return list;
}

export { CONTRACT_ADDRESS };

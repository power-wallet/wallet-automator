import { Contract, JsonRpcProvider, Wallet, AbiCoder } from "ethers";
import { CHAINS, type ChainConfig, type ChainKey, type SimpleUpkeep } from "./chains";

const AUTOMATOR_ABI = [
  "function getAllWallets() view returns (address[])",
  "function getWalletDebug(address wallet) view returns (bool isClosed, bool paused, bool upkeepNeeded, bytes performData)",
  "function performUpkeep(bytes) external",
];

const UPKEEP_ABI = [
  "function checkUpkeep(bytes) view returns (bool upkeepNeeded, bytes performData)",
  "function performUpkeep(bytes) external",
];

export type Skip = { target: string; reason: string };
export type Perform = { target: string; txHash: string; blockNumber: number };

export type KeeperResult = {
  chain: string;
  chainId: number;
  signer: string;
  performed: Perform[];
  skipped: Skip[];
  idle: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errReason(e: unknown): string {
  if (e && typeof e === "object") {
    const anyErr = e as { shortMessage?: string; message?: string };
    return anyErr.shortMessage || anyErr.message || String(e);
  }
  return String(e);
}

export function getSigner(chain: ChainConfig): { provider: JsonRpcProvider; signer: Wallet } {
  const rpc = process.env[chain.rpcEnv] || chain.defaultRpc;
  const key = requireEnv("KEEPER_PRIVATE_KEY");
  const provider = new JsonRpcProvider(rpc, chain.chainId);
  const signer = new Wallet(key, provider);
  return { provider, signer };
}

async function performSimpleUpkeep(
  signer: Wallet,
  upkeep: SimpleUpkeep,
  result: KeeperResult
): Promise<void> {
  const contract = new Contract(upkeep.address, UPKEEP_ABI, signer);
  const [needed, performData] = await contract.checkUpkeep("0x");
  if (!needed) {
    result.idle.push(upkeep.name);
    return;
  }

  try {
    await contract.performUpkeep.staticCall(performData);
  } catch (e) {
    result.skipped.push({ target: upkeep.name, reason: `dry-run: ${errReason(e)}` });
    return;
  }

  try {
    const estimated: bigint = await contract.performUpkeep.estimateGas(performData);
    const tx = await contract.performUpkeep(performData, {
      gasLimit: (estimated * 125n) / 100n,
    });
    const receipt = await tx.wait();
    if (receipt?.status === 1) {
      result.performed.push({
        target: upkeep.name,
        txHash: tx.hash,
        blockNumber: Number(receipt.blockNumber),
      });
    } else {
      result.skipped.push({ target: upkeep.name, reason: "tx reverted" });
    }
  } catch (e) {
    result.skipped.push({ target: upkeep.name, reason: errReason(e) });
  }
}

async function performAutomatorUpkeeps(
  signer: Wallet,
  automatorAddress: string,
  maxTxs: number,
  result: KeeperResult
): Promise<void> {
  const automator = new Contract(automatorAddress, AUTOMATOR_ABI, signer);
  const wallets: string[] = await automator.getAllWallets();
  let sent = 0;
  let eligible = 0;

  for (const wallet of wallets) {
    if (sent >= maxTxs) break;

    const [isClosed, paused, upkeepNeeded, performData] = await automator.getWalletDebug(wallet);
    if (isClosed || paused || !upkeepNeeded) continue;
    eligible++;

    const payload = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes"],
      [wallet, performData]
    );

    try {
      await automator.performUpkeep.staticCall(payload);
    } catch (e) {
      result.skipped.push({ target: wallet, reason: `dry-run: ${errReason(e)}` });
      continue;
    }

    try {
      const estimated: bigint = await automator.performUpkeep.estimateGas(payload);
      const tx = await automator.performUpkeep(payload, {
        gasLimit: (estimated * 125n) / 100n,
      });
      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        result.performed.push({
          target: wallet,
          txHash: tx.hash,
          blockNumber: Number(receipt.blockNumber),
        });
        sent++;
      } else {
        result.skipped.push({ target: wallet, reason: "tx reverted" });
      }
    } catch (e) {
      result.skipped.push({ target: wallet, reason: errReason(e) });
    }

    await sleep(1000);
  }

  if (eligible === 0) {
    result.idle.push("WalletAutomator");
  }
}

/**
 * Frequent schedule: WalletAutomator + non-TI frequent upkeeps (e.g. PoolRebalancer).
 * TechnicalIndicators is intentionally excluded — use runIndicatorsDaily.
 */
export async function runFrequentUpkeep(chainKey: ChainKey): Promise<KeeperResult> {
  const chain = CHAINS[chainKey];
  const { signer } = getSigner(chain);
  const maxTxs = Number(process.env.MAX_AUTOMATOR_TXS || 3);

  const result: KeeperResult = {
    chain: chain.name,
    chainId: chain.chainId,
    signer: signer.address,
    performed: [],
    skipped: [],
    idle: [],
  };

  await performAutomatorUpkeeps(signer, chain.automator, maxTxs, result);

  for (const upkeep of chain.frequentUpkeeps) {
    await performSimpleUpkeep(signer, upkeep, result);
  }

  return result;
}

/** Daily midnight-UTC window only: TechnicalIndicators on the given chain(s). */
export async function runIndicatorsDaily(chainKeys: ChainKey[]): Promise<KeeperResult[]> {
  const results: KeeperResult[] = [];

  for (const chainKey of chainKeys) {
    const chain = CHAINS[chainKey];
    const { signer } = getSigner(chain);
    const result: KeeperResult = {
      chain: chain.name,
      chainId: chain.chainId,
      signer: signer.address,
      performed: [],
      skipped: [],
      idle: [],
    };

    await performSimpleUpkeep(signer, chain.technicalIndicators, result);
    results.push(result);
  }

  return results;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

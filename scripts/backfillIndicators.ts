import 'dotenv/config';
import { ethers } from 'hardhat';

/**
 * Backfills missing TechnicalIndicators daily closes from Coinbase, then
 * recomputes the derived indicators (EWMA volatility, drawdown).
 *
 * Dry-run by default: prints the plan without sending transactions.
 * Set EXECUTE=1 to submit backfillDailyPrices + recomputeIndicators (owner only).
 */

const TI_BY_CHAIN: Record<number, string> = {
  84532: '0x7A0F3B371A2563627EfE1967E7645812909Eb6c5', // Base Sepolia
  8453: '0xE0087A5EcAaF884894946191eb9d5FD0841D95Ec', // Base Mainnet
};

// Tracked token → Coinbase product (lowercase addresses)
const PRODUCT_BY_TOKEN: Record<string, string> = {
  '0xcbb7c0006f23900c38eb856149f799620fcb8a4a': 'BTC-USD', // cbBTC (Base Sepolia)
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'BTC-USD', // cbBTC (Base Mainnet)
  '0x4200000000000000000000000000000000000006': 'ETH-USD', // WETH
};

const ABI = [
  'function getTrackedTokens() view returns (address[])',
  'function getFullPriceHistory(address) view returns (tuple(uint256 timestamp, uint256 price)[])',
  'function backfillDailyPrices(address token, uint256[] timestamps, uint256[] prices) external',
  'function recomputeIndicators(address token) external',
  'function owner() view returns (address)',
];

const DAY = 86400;
const SCALE = 1e8;
const fmt = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Daily close per UTC-midnight bucket from Coinbase Exchange candles. */
async function fetchDailyCloses(product: string, startTs: number, endTs: number): Promise<Map<number, number>> {
  const url =
    `https://api.exchange.coinbase.com/products/${product}/candles` +
    `?granularity=86400&start=${new Date(startTs * 1000).toISOString()}&end=${new Date((endTs + DAY) * 1000).toISOString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'powerwallet-backfill' } });
  if (!res.ok) throw new Error(`Coinbase ${product} ${res.status}: ${await res.text()}`);
  const candles: [number, number, number, number, number, number][] = await res.json();

  // Candle format: [bucketStart, low, high, open, close, volume]
  const closes = new Map<number, number>();
  for (const [time, , , , close] of candles) closes.set(time, close);
  return closes;
}

async function main() {
  const execute = process.env.EXECUTE === '1';
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const address = TI_BY_CHAIN[chainId];
  if (!address) throw new Error(`No TechnicalIndicators address for chain ${chainId}`);

  const [signer] = await ethers.getSigners();
  const ti = new ethers.Contract(address, ABI, signer);

  const owner = await ti.owner();
  console.log(`TechnicalIndicators ${address} (chain ${chainId})`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'dry-run'} | signer ${signer.address} | owner ${owner}`);
  if (execute && owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error('Signer is not the contract owner');
  }

  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % DAY);
  const yesterday = today - DAY;

  const tokens: string[] = await ti.getTrackedTokens();
  for (const token of tokens) {
    const product = PRODUCT_BY_TOKEN[token.toLowerCase()];
    if (!product) {
      console.log(`\n${token}: no Coinbase product mapping — SKIPPED, add it to PRODUCT_BY_TOKEN`);
      continue;
    }

    const history = await ti.getFullPriceHistory(token);
    if (history.length === 0) {
      console.log(`\n${token}: empty history — cannot backfill safely, skipping`);
      continue;
    }
    const last = history[history.length - 1];
    const lastTs = Number(last.timestamp);

    const missing: number[] = [];
    for (let ts = lastTs + DAY; ts <= yesterday; ts += DAY) missing.push(ts);

    console.log(`\n${token} (${product}): last entry ${fmt(lastTs)}, missing ${missing.length} day(s)`);
    if (missing.length === 0) continue;

    const closes = await fetchDailyCloses(product, lastTs, yesterday);

    // Sanity check: our source vs the last on-chain entry
    const refClose = closes.get(lastTs);
    if (refClose !== undefined) {
      const stored = Number(last.price) / SCALE;
      const devBps = Math.abs(refClose - stored) / stored * 10000;
      console.log(`  sanity ${fmt(lastTs)}: on-chain ${stored} vs Coinbase ${refClose} (dev ${devBps.toFixed(1)} bps)`);
      if (devBps > 200) throw new Error('Source deviates >2% from last on-chain close — aborting');
    }

    const timestamps: bigint[] = [];
    const prices: bigint[] = [];
    for (const ts of missing) {
      const close = closes.get(ts);
      if (close === undefined) throw new Error(`Missing Coinbase candle for ${fmt(ts)} (${product})`);
      timestamps.push(BigInt(ts));
      prices.push(BigInt(Math.round(close * SCALE)));
      console.log(`  ${fmt(ts)}  close ${close}`);
    }

    if (!execute) {
      console.log(`  dry-run: would backfill ${missing.length} entries + recomputeIndicators`);
      continue;
    }

    const tx1 = await ti.backfillDailyPrices(token, timestamps, prices);
    console.log(`  backfillDailyPrices sent ${tx1.hash}`);
    const r1 = await tx1.wait();
    console.log(`  backfillDailyPrices ${r1?.status === 1 ? 'success' : 'REVERTED'} (block ${r1?.blockNumber})`);

    const tx2 = await ti.recomputeIndicators(token);
    console.log(`  recomputeIndicators sent ${tx2.hash}`);
    const r2 = await tx2.wait();
    console.log(`  recomputeIndicators ${r2?.status === 1 ? 'success' : 'REVERTED'} (block ${r2?.blockNumber})`);
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

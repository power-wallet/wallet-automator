import 'dotenv/config';
import { ethers } from 'hardhat';

/**
 * Read-only report of TechnicalIndicators daily price history state.
 * Shows the last recorded day per tracked token and any gap that would
 * block automation (checkUpkeep refuses to run when history has gaps).
 */

const TI_BY_CHAIN: Record<number, string> = {
  84532: '0x7A0F3B371A2563627EfE1967E7645812909Eb6c5', // Base Sepolia
  8453: '0xE0087A5EcAaF884894946191eb9d5FD0841D95Ec', // Base Mainnet
};

const ABI = [
  'function trackedTokens(uint256) view returns (address)',
  'function tokenConfigs(address) view returns (address priceFeed, uint256 lastUpdateTimestamp)',
  'function getFullPriceHistory(address) view returns (tuple(uint256 timestamp, uint256 price)[])',
];

const DAY = 86400;
const fmt = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const address = TI_BY_CHAIN[chainId];
  if (!address) throw new Error(`No TechnicalIndicators address configured for chain ${chainId}`);

  const ti = new ethers.Contract(address, ABI, ethers.provider);
  console.log(`TechnicalIndicators ${address} (chain ${chainId})`);

  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % DAY);
  const yesterday = today - DAY;
  console.log(`Today UTC: ${fmt(today)} — history is complete when the last entry is ${fmt(yesterday)}\n`);

  for (let i = 0; ; i++) {
    let token: string;
    try {
      token = await ti.trackedTokens(i);
    } catch {
      break;
    }

    const [priceFeed, lastUpdate] = await ti.tokenConfigs(token);
    const history = await ti.getFullPriceHistory(token);
    if (history.length === 0) {
      console.log(`${token}: NO HISTORY (feed ${priceFeed})`);
      continue;
    }

    const last = history[history.length - 1];
    const lastTs = Number(last.timestamp);
    const missingDays = Math.max(0, (yesterday - lastTs) / DAY);
    const status = missingDays === 0 ? 'OK, up to date' : `GAP: ${missingDays} missing day(s) — needs owner backfill`;
    console.log(`${token}:`);
    console.log(`  entries: ${history.length}, last entry: ${fmt(lastTs)}, last price: ${Number(last.price) / 1e8}`);
    console.log(`  lastUpdateTimestamp: ${fmt(Number(lastUpdate))}`);
    console.log(`  ${status}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

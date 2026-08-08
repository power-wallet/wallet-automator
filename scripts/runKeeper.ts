import 'dotenv/config';
import { ethers } from 'hardhat';

/**
 * Stopgap keeper: replaces Chainlink Automation until the CRE workflow is live.
 *
 * Instead of relying on the automator's own scan (which gets stuck on a wallet
 * whose performUpkeep reverts, e.g. on swap slippage), this enumerates every
 * wallet, dry-runs performUpkeep for the ones that need work, and only sends
 * transactions that will succeed. Reverting wallets are reported and skipped.
 */

const AUTOMATOR = process.env.AUTOMATOR_PROXY_ADDRESS || '0x79cec041e963526122ffC7C04F427595a132331B';

// Standalone custom-logic upkeeps serviced with plain checkUpkeep/performUpkeep, per chain id.
const SIMPLE_UPKEEPS: Record<number, { name: string; address: string }[]> = {
  // Base Sepolia
  84532: [
    { name: 'TechnicalIndicators', address: '0x7A0F3B371A2563627EfE1967E7645812909Eb6c5' },
    { name: 'PoolRebalancer', address: '0xCbad841061ea2cFD74f0adF2F06488596138B4A9' },
  ],
  // Base Mainnet
  8453: [
    { name: 'TechnicalIndicators', address: '0xE0087A5EcAaF884894946191eb9d5FD0841D95Ec' },
  ],
};

const ABI = [
  'function getAllWallets() view returns (address[])',
  'function getWalletDebug(address wallet) view returns (bool isClosed, bool paused, bool upkeepNeeded, bytes performData)',
  'function performUpkeep(bytes) external',
];

const UPKEEP_ABI = [
  'function checkUpkeep(bytes) view returns (bool upkeepNeeded, bytes performData)',
  'function performUpkeep(bytes) external',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const [signer] = await ethers.getSigners();
  const automator = new ethers.Contract(AUTOMATOR, ABI, signer);
  console.log(`Keeper for WalletAutomator ${AUTOMATOR}`);
  console.log(`Signer: ${signer.address}`);

  const wallets: string[] = await automator.getAllWallets();
  console.log(`Wallets in factory: ${wallets.length}`);

  let performed = 0;
  const skipped: { wallet: string; reason: string }[] = [];

  for (const wallet of wallets) {
    const [isClosed, paused, upkeepNeeded, performData] = await automator.getWalletDebug(wallet);
    if (isClosed || paused || !upkeepNeeded) continue;

    const payload = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'bytes'], [wallet, performData]);

    try {
      await automator.performUpkeep.staticCall(payload);
    } catch (e: any) {
      const reason = e?.shortMessage || e?.message || String(e);
      console.log(`SKIP ${wallet}: dry-run reverted (${reason})`);
      skipped.push({ wallet, reason });
      continue;
    }

    try {
      const estimated = await automator.performUpkeep.estimateGas(payload);
      const tx = await automator.performUpkeep(payload, { gasLimit: (estimated * 125n) / 100n });
      console.log(`PERFORM ${wallet}: sent ${tx.hash} (gas est ${estimated})`);
      const receipt = await tx.wait();
      console.log(`PERFORM ${wallet}: ${receipt?.status === 1 ? 'success' : 'REVERTED'} in block ${receipt?.blockNumber}`);
      if (receipt?.status === 1) performed++;
    } catch (e: any) {
      const reason = e?.shortMessage || e?.message || String(e);
      console.log(`FAIL ${wallet}: ${reason}`);
      skipped.push({ wallet, reason });
    }

    await sleep(2000);
  }

  // Service the standalone upkeeps (TechnicalIndicators, PoolRebalancer) on this chain.
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  for (const upkeep of SIMPLE_UPKEEPS[chainId] ?? []) {
    const contract = new ethers.Contract(upkeep.address, UPKEEP_ABI, signer);
    const [needed, performData] = await contract.checkUpkeep('0x');
    if (!needed) {
      console.log(`${upkeep.name}: no upkeep needed`);
      continue;
    }

    try {
      await contract.performUpkeep.staticCall(performData);
    } catch (e: any) {
      const reason = e?.shortMessage || e?.message || String(e);
      console.log(`SKIP ${upkeep.name}: dry-run reverted (${reason})`);
      skipped.push({ wallet: `${upkeep.name} ${upkeep.address}`, reason });
      continue;
    }

    try {
      const estimated = await contract.performUpkeep.estimateGas(performData);
      const tx = await contract.performUpkeep(performData, { gasLimit: (estimated * 125n) / 100n });
      console.log(`PERFORM ${upkeep.name}: sent ${tx.hash} (gas est ${estimated})`);
      const receipt = await tx.wait();
      console.log(`PERFORM ${upkeep.name}: ${receipt?.status === 1 ? 'success' : 'REVERTED'} in block ${receipt?.blockNumber}`);
      if (receipt?.status === 1) performed++;
    } catch (e: any) {
      const reason = e?.shortMessage || e?.message || String(e);
      console.log(`FAIL ${upkeep.name}: ${reason}`);
      skipped.push({ wallet: `${upkeep.name} ${upkeep.address}`, reason });
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Upkeeps performed: ${performed}`);
  if (skipped.length > 0) {
    console.log(`Wallets needing attention (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s.wallet} — ${s.reason}`);
  } else {
    console.log('No stuck wallets.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

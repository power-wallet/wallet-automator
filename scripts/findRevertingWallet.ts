import 'dotenv/config';
import { ethers } from 'hardhat';

async function main() {
  const AUTOMATOR = process.env.AUTOMATOR_PROXY_ADDRESS as string;
  if (!AUTOMATOR) throw new Error('AUTOMATOR_PROXY_ADDRESS not set');

  const automator = await ethers.getContractAt('WalletAutomator', AUTOMATOR);

  const [startIdx, maxPerScan] = (await automator.getScanState()).slice(0, 2);
  const order = await automator.getCurrentScanOrder();
  console.log('[Scan] startIdx=', startIdx.toString(), 'maxPerScan=', maxPerScan.toString(), 'orderLen=', order.length);

  // Simulate the exact scan sequence used by _findNextEligible (wrap-around)
  const total = order.length;
  const normalizedStart = Number(startIdx % BigInt(total));
  const limit = Math.min(Number(maxPerScan), total);

  for (let step = 1; step <= limit; step++) {
    const idx = (normalizedStart + step) % total;
    const w = order[idx];
    console.log(`[Probe Wallet ${step}/${limit}] idx=${idx} addr=${w}`);

    // Probe wallet directly via IPowerWallet
    const wallet = await ethers.getContractAt('IPowerWallet', w);

    try {
      const closed = await wallet.isClosed();
      console.log('  isClosed ok ->', closed);
    } catch (e: any) {
      console.error('  isClosed REVERT ->', e?.shortMessage || e?.message || e);
      continue;
    }

    try {
      const paused = await wallet.automationPaused();
      console.log('  automationPaused ok ->', paused);
    } catch (e: any) {
      console.error('  automationPaused REVERT ->', e?.shortMessage || e?.message || e);
      continue;
    }

    try {
      const [needed, pdata] = await wallet.checkUpkeep('0x');
      console.log('  checkUpkeep ok -> needed=', needed, 'performDataLen=', (pdata?.length || 0));
    } catch (e: any) {
      console.error('  checkUpkeep REVERT ->', e?.shortMessage || e?.message || e);
      continue;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



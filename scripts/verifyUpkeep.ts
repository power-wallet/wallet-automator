import 'dotenv/config';
import { ethers } from 'hardhat';

async function main() {
  const AUTOMATOR = process.env.AUTOMATOR_PROXY_ADDRESS as string;
  const WALLET = process.env.WALLET_ADDRESS as string;
  if (!AUTOMATOR) throw new Error('AUTOMATOR_PROXY_ADDRESS not set');
  if (!WALLET) throw new Error('WALLET_ADDRESS not set');

  const automator = await ethers.getContractAt('WalletAutomator', AUTOMATOR);
  const wallet = await ethers.getContractAt('IPowerWallet', WALLET);

  // Wallet status
  const [isClosed, paused, walletUpkeepNeeded, walletPerformData] = await automator.getWalletDebug(WALLET);
  console.log('[Wallet Debug] isClosed=', isClosed, 'paused=', paused, 'upkeepNeeded=', walletUpkeepNeeded, 'performDataLen=', (walletPerformData?.length || 0));

  // Automator checkUpkeep
  const [automatorUpkeepNeeded, automatorPerformData] = await automator.checkUpkeep('0x');
  console.log('[Automator checkUpkeep] upkeepNeeded=', automatorUpkeepNeeded, 'performDataLen=', (automatorPerformData?.length || 0));

  // Scan state & order
  const scanState = await automator.getScanState();
  const [startIdx, maxPerScan, minBetweenRuns, lastRun, totalWallets] = scanState;
  console.log('[ScanState] startIdx=', startIdx.toString(), 'maxPerScan=', maxPerScan.toString(), 'minBetweenRuns=', minBetweenRuns.toString(), 'lastRun=', lastRun.toString(), 'totalWallets=', totalWallets.toString());

  const order = await automator.getCurrentScanOrder();
  console.log('[CurrentScanOrder] total=', order.length);
  for (let i = 0; i < order.length; i++) {
    console.log(`  [${i}] ${order[i]}`);
  }

  // Find wallet index and window
  const [found, flatIndex] = await automator.findWalletFlatIndex(WALLET);
  console.log('[FlatIndex]', 'found=', found, 'index=', flatIndex.toString());

  const window = await automator.getScanWindow(startIdx, maxPerScan);
  const [windowWallets, total] = window;
  console.log('[ScanWindow] count=', windowWallets.length, 'of total=', total.toString());
  for (let i = 0; i < windowWallets.length; i++) {
    console.log(`  window[${i}] ${windowWallets[i]}`);
  }

  const lastRuns = await automator.getPerWalletLastRun(Array.from(order));
  console.log('[PerWalletLastRun]');
  for (let i = 0; i < order.length; i++) {
    console.log(`  ${order[i]} -> ${lastRuns[i].toString()}`);
  }

  // Preview next eligible from current state
  const preview = await automator.previewNextEligible(startIdx, maxPerScan);
  const [foundNext, nextWallet, _nextData, advanced] = preview;
  console.log('[PreviewNextEligible]', 'found=', foundNext, 'wallet=', nextWallet, 'advanced=', advanced?.toString?.() ?? advanced);

  // Detailed per-wallet debug in the current scan window
  console.log('[WindowWalletsDebug]');
  for (let i = 0; i < windowWallets.length; i++) {
    const w = windowWallets[i];
    const [wClosed, wPaused, wUpkeepNeeded, wPerformData] = await automator.getWalletDebug(w);
    console.log(`  ${w} -> closed=${wClosed} paused=${wPaused} upkeepNeeded=${wUpkeepNeeded} performDataLen=${wPerformData?.length || 0}`);
  }

  if (walletUpkeepNeeded && !automatorUpkeepNeeded) {
    console.error('Mismatch: wallet reports upkeepNeeded=true but automator reports upkeepNeeded=false');
    process.exit(2);
  }

  if (!walletUpkeepNeeded && automatorUpkeepNeeded) {
    console.error('Unexpected: automator wants to perform but wallet does not need upkeep');
    process.exit(3);
  }

  console.log('Verification complete. States are consistent.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



import 'dotenv/config';
import { ethers } from 'hardhat';

async function main() {
  const AUTOMATOR = process.env.AUTOMATOR_PROXY_ADDRESS as string;
  if (!AUTOMATOR) throw new Error('AUTOMATOR_PROXY_ADDRESS not set');

  const PROBE_GAS_LIMIT = process.env.PROBE_GAS_LIMIT ? BigInt(process.env.PROBE_GAS_LIMIT) : 5_000_000n;
  const CALLER = process.env.PROBE_CALLER;

  const provider = ethers.provider;
  const automator = await ethers.getContractAt('WalletAutomator', AUTOMATOR);
  const iface = automator.interface;

  const data = iface.encodeFunctionData('checkUpkeep', ['0x']);
  const txReq: any = { to: AUTOMATOR, data, gasLimit: PROBE_GAS_LIMIT };
  if (CALLER) txReq.from = CALLER;

  console.log('[Probe] to=', AUTOMATOR, 'gasLimit=', PROBE_GAS_LIMIT.toString(), CALLER ? `from=${CALLER}` : '');

  try {
    const result = await provider.call(txReq);
    const [upkeepNeeded, performData] = iface.decodeFunctionResult('checkUpkeep', result);
    console.log('[eth_call success] upkeepNeeded=', upkeepNeeded, 'performDataLen=', (performData?.length || 0));
  } catch (e: any) {
    console.error('[eth_call revert] message=', e?.shortMessage || e?.message || e);
    if (e?.data) console.error('[eth_call revert data]=', e.data);
  }

  // Cross-check via contract call (still an eth_call under the hood)
  try {
    // @ts-ignore ethers v6 accepts gasLimit in overrides
    const [upkeepNeeded2, performData2] = await automator.checkUpkeep('0x', { gasLimit: PROBE_GAS_LIMIT });
    console.log('[contract.call success] upkeepNeeded=', upkeepNeeded2, 'performDataLen=', (performData2?.length || 0));
  } catch (e: any) {
    console.error('[contract.call revert] message=', e?.shortMessage || e?.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



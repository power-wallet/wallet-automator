import {
  cre,
  EVMClient,
  getNetwork,
  bytesToHex,
  protoBigIntToBigint,
  LAST_FINALIZED_BLOCK_NUMBER,
  TxStatus,
  type Runtime,
  Runner,
} from "@chainlink/cre-sdk";
import { encodeFunctionData, encodeAbiParameters, type Hex, type Address } from "viem";
import { z } from "zod";
import { IAutomationCompatibleABI } from "../contracts/evm/ts/generated/IAutomationCompatible";
import { AutomationReceiver } from "../contracts/evm/ts/generated/AutomationReceiver";
import { IAutomationCompatible } from "../contracts/evm/ts/generated/IAutomationCompatible";

// ─── Config Schema ──────────────────────────────────────────
// Multi-target migration of Power Wallet's custom-logic upkeeps
// (WalletAutomator, TechnicalIndicators, Pool Rebalancer). Every
// target follows the CLA pattern: checkUpkeep (off-chain read) →
// performUpkeep(performData) via the AutomationReceiver bridge.
const configSchema = z.object({
  chainSelectorName: z.string(),
  receiverAddress: z.string(),
  targets: z
    .array(
      z.object({
        name: z.string(),
        address: z.string(),
        checkData: z.string().optional(),
      })
    )
    .min(1),
  schedule: z.string(),
  writeGasLimit: z.string().optional(),
});
type Config = z.infer<typeof configSchema>;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function assertConfiguredAddress(value: string | undefined, fieldName: string): asserts value is Address {
  if (!value || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${fieldName} must be configured with a deployed contract address`);
  }
}

// ─── Handler ────────────────────────────────────────────────
const onCronTrigger = (runtime: Runtime<Config>): string => {
  const config = runtime.config;
  const writeGasLimit = config.writeGasLimit ?? "800000";
  assertConfiguredAddress(config.receiverAddress, "receiverAddress");
  runtime.log(`=== Power Wallet upkeep run: ${config.targets.length} targets ===`);

  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName });
  if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`);

  const evmClient = new EVMClient(network.chainSelector.selector);
  const receiver = new AutomationReceiver(evmClient, config.receiverAddress);

  // Reports are stamped with the last finalized block; checkUpkeep reads use
  // the same tag, so the receiver's optional monotonicity check stays consistent.
  const header = evmClient.headerByNumber(runtime, { blockNumber: LAST_FINALIZED_BLOCK_NUMBER }).result();
  const reportBlockNumber = header.header?.blockNumber ? protoBigIntToBigint(header.header.blockNumber) : 0n;

  const results: string[] = [];

  for (const targetCfg of config.targets) {
    assertConfiguredAddress(targetCfg.address, `target ${targetCfg.name}`);
    const target = new IAutomationCompatible(evmClient, targetCfg.address);

    const [upkeepNeeded, performData] = target.checkUpkeep(runtime, (targetCfg.checkData ?? "0x") as Hex);
    if (!upkeepNeeded) {
      runtime.log(`${targetCfg.name}: no upkeep needed`);
      results.push(`${targetCfg.name}: idle`);
      continue;
    }

    runtime.log(`${targetCfg.name}: upkeep needed, submitting report`);
    const callData = encodeFunctionData({
      abi: IAutomationCompatibleABI,
      functionName: "performUpkeep",
      args: [performData],
    });

    const reportPayload = encodeAbiParameters(
      [
        { name: "target", type: "address" },
        { name: "blockNumber", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
      [targetCfg.address as Address, reportBlockNumber, callData]
    );

    const writeResult = receiver.writeReport(runtime, reportPayload, { gasLimit: writeGasLimit });
    if (writeResult.txStatus !== TxStatus.SUCCESS) {
      runtime.log(`${targetCfg.name}: write FAILED (${writeResult.errorMessage || writeResult.txStatus})`);
      results.push(`${targetCfg.name}: write failed`);
      continue;
    }

    const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
    runtime.log(`${targetCfg.name}: performed, tx ${txHash}`);
    results.push(`${targetCfg.name}: performed ${txHash}`);
  }

  return results.join(" | ");
};

// ─── Workflow Init ──────────────────────────────────────────
function initWorkflow(config: Config) {
  return [
    cre.handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), onCronTrigger),
  ];
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();

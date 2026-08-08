/**
 * Frequent Base Sepolia upkeep: WalletAutomator + PoolRebalancer.
 * TechnicalIndicators is handled by indicators-daily.
 */
import type { Config } from "@netlify/functions";
import { jsonResponse, runFrequentUpkeep } from "./lib/keeper";

export const config: Config = {
  // Every 15 minutes.
  schedule: "*/15 * * * *",
};

export default async (): Promise<Response> => {
  try {
    const result = await runFrequentUpkeep("base-sepolia");
    console.log("[upkeep-sepolia]", JSON.stringify(result));
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[upkeep-sepolia]", error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
};

/**
 * TechnicalIndicators daily update for Base mainnet + Base Sepolia.
 *
 * TI only accepts updates in the first hour after midnight UTC. Fire a few
 * times inside that window so a single flaky RPC/tx doesn't open a gap.
 */
import type { Config } from "@netlify/functions";
import { jsonResponse, runIndicatorsDaily } from "./lib/keeper";

export const config: Config = {
  // 00:10, 00:25, 00:40 UTC.
  schedule: "10,25,40 0 * * *",
};

export default async (): Promise<Response> => {
  try {
    const results = await runIndicatorsDaily(["base", "base-sepolia"]);
    console.log("[indicators-daily]", JSON.stringify(results));
    return jsonResponse({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[indicators-daily]", error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
};

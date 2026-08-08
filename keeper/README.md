# PowerWallet Netlify Keeper

Scheduled Netlify functions that replace Chainlink Automation / CRE for Power Wallet upkeeps.

## Schedules

| Function | Cron (UTC) | What it runs |
|---|---|---|
| `upkeep-mainnet` | every 15 min | Base `WalletAutomator` |
| `upkeep-sepolia` | every 15 min | Base Sepolia `WalletAutomator` + `PoolRebalancer` |
| `indicators-daily` | `10,25,40 0 * * *` | `TechnicalIndicators` on both chains (midnight UTC window only) |

Logic dry-runs `performUpkeep` before sending, skips reverting wallets, and caps automator txs per invocation (`MAX_AUTOMATOR_TXS`, default 3) so runs stay inside Netlify timeouts.

## Deploy (new Netlify site)

1. Create a new site in Netlify and set **Base directory** to `keeper` (this folder), or deploy from this folder with the Netlify CLI.
2. Set environment variables (Site settings → Environment variables):

```
KEEPER_PRIVATE_KEY=0x...          # dedicated keeper EOA only
BASE_RPC_URL=https://...          # optional; defaults to public Base RPC
BASE_SEPOLIA_RPC_URL=https://...  # optional
```

3. Deploy. Confirm the three functions appear under **Functions** and show schedules.
4. Watch the first runs in **Functions → Logs**.
5. Once green for a day, remove the laptop crontab entry for `scripts/keeperCron.sh`.

### CLI deploy from this folder

```bash
cd keeper
npm install
npx netlify login
npx netlify init          # link/create site, base dir = .
npx netlify env:set KEEPER_PRIVATE_KEY 0x...
npx netlify deploy --prod
```

## Local typecheck

```bash
cd keeper
npm install
npm run typecheck
```

## Security notes

- Use a **dedicated** keeper wallet funded with gas only (Base + Base Sepolia ETH).
- Do not reuse your treasury / owner key if you can avoid it.
- Contracts currently accept any caller for `performUpkeep`; the key is the trust boundary.

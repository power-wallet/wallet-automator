# Wallet Automator (Base / Base Sepolia)

Upgradable Chainlink Automation-compatible contract to orchestrate PowerWallet instances created by `WalletFactory`.

## Features
- UUPS upgradable `WalletAutomator`
- Scans `WalletFactory.getUsers()` and `getUserWallets(user)`
- Skips closed or automationPaused wallets
- Triggers the first wallet that needs upkeep per run
- Throttles runs (default 10 minutes) and caps scan size (default 25)
- Hardhat config for `base` and `base-sepolia`

## Deployed Contract 

- Base Sepolia: [0x79cec041e963526122ffC7C04F427595a132331B](https://sepolia.basescan.org/address/0x79cec041e963526122ffC7C04F427595a132331B#code)


## Setup
1. Install deps
```bash
npm install
```
2. Copy env
```bash
cp .env.example .env
# Fill PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, BASE_RPC_URL, BASESCAN_API_KEY, WALLET_FACTORY_ADDRESS
```

## Build & Test
```bash
npx hardhat compile
npx hardhat test
```

## Deploy
Set the `WALLET_FACTORY_ADDRESS` env to the Base Sepolia address from the WalletFactory repo reference. 
- 0x6e6A4C1094a064030c30607549BF8d87311cB219 on Base Sepolia

```bash
WALLET_FACTORY_ADDRESS=0xYourFactory \
  npx hardhat run scripts/deploy.ts --network base-sepolia
```

## Upgrade
```bash
AUTOMATOR_PROXY_ADDRESS=0xProxy npx hardhat run scripts/upgrade.ts --network base-sepolia
```

## Notes
- `checkUpkeep` returns true only if outside the throttle window and at least one wallet needs upkeep.
- `performUpkeep` executes only one wallet per run to control gas.


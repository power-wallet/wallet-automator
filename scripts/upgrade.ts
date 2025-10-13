import 'dotenv/config';
import { ethers, upgrades } from 'hardhat';

async function main() {
  const proxyAddress = process.env.AUTOMATOR_PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error('AUTOMATOR_PROXY_ADDRESS env not set');
  }

  const WalletAutomator = await ethers.getContractFactory('WalletAutomator');
  const upgraded = await upgrades.upgradeProxy(proxyAddress, WalletAutomator);
  // @ts-ignore
  if (typeof (upgraded as any).waitForDeployment === 'function') {
    // @ts-ignore
    await (upgraded as any).waitForDeployment();
  }

  // @ts-ignore
  const addr = typeof (upgraded as any).getAddress === 'function' ? await (upgraded as any).getAddress() : (upgraded as any).address;
  console.log('WalletAutomator upgraded at proxy:', addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



import 'dotenv/config';
import { ethers, upgrades } from 'hardhat';

async function main() {
  const factoryAddress = process.env.WALLET_FACTORY_ADDRESS;
  if (!factoryAddress) {
    throw new Error('WALLET_FACTORY_ADDRESS env not set');
  }

  const WalletAutomator = await ethers.getContractFactory('WalletAutomator');
  const proxy = await upgrades.deployProxy(WalletAutomator, [factoryAddress], {
    kind: 'uups',
    initializer: 'initialize'
  });
  // ethers v6 compatible
  // @ts-ignore
  if (typeof (proxy as any).waitForDeployment === 'function') {
    // @ts-ignore
    await (proxy as any).waitForDeployment();
  }

  // @ts-ignore
  const addr = typeof (proxy as any).getAddress === 'function' ? await (proxy as any).getAddress() : (proxy as any).address;
  console.log('WalletAutomator proxy deployed:', addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



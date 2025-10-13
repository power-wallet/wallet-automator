import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

describe('WalletAutomator', function () {
  async function deploy() {
    const [deployer, user1, user2] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('MockWalletFactory');
    const factory = await Factory.deploy();
    // ethers v6 style instances don't have deployed(); use waitForDeployment
    // @ts-ignore
    if (typeof (factory as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (factory as any).waitForDeployment();
    }

    const W = await ethers.getContractFactory('MockPowerWallet');
    const w1 = await W.deploy();
    // @ts-ignore
    if (typeof (w1 as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (w1 as any).waitForDeployment();
    }
    const w2 = await W.deploy();
    // @ts-ignore
    if (typeof (w2 as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (w2 as any).waitForDeployment();
    }

    const user1Addr = user1.address;
    const user2Addr = user2.address;
    await factory.addUser(user1Addr);
    await factory.addUser(user2Addr);
    const w1Addr = typeof (w1 as any).getAddress === 'function' ? await (w1 as any).getAddress() : (w1 as any).address;
    const w2Addr = typeof (w2 as any).getAddress === 'function' ? await (w2 as any).getAddress() : (w2 as any).address;
    await factory.addWallet(user1Addr, w1Addr);
    await factory.addWallet(user2Addr, w2Addr);

    const Automator = await ethers.getContractFactory('WalletAutomator');
    const factoryAddr = typeof (factory as any).getAddress === 'function' ? await (factory as any).getAddress() : (factory as any).address;
    const automator = await upgrades.deployProxy(Automator, [factoryAddr], {
      kind: 'uups',
      initializer: 'initialize'
    });
    // @ts-ignore
    if (typeof (automator as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (automator as any).waitForDeployment();
    }

    return { deployer, factory, w1, w2, automator };
  }

  it('initializes and sets defaults', async () => {
    const { automator, factory } = await deploy();
    const factoryAddrNow = typeof (factory as any).getAddress === 'function' ? await (factory as any).getAddress() : (factory as any).address;
    expect(await automator.walletFactory()).to.eq(factoryAddrNow);
    expect(await automator.maxWalletsPerScan()).to.be.gt(0);
    expect(await automator.minSecondsBetweenRuns()).to.be.gt(0);
  });

  it('checkUpkeep false when throttled', async () => {
    const { automator, w1 } = await deploy();
    await w1.setNeedsUpkeep(true);
    const [needed, performData] = await automator.checkUpkeep('0x');
    expect(needed).to.eq(true);
    const tx = await automator.performUpkeep(performData);
    await tx.wait();
    const [needed2] = await automator.checkUpkeep('0x');
    expect(needed2).to.eq(false);
  });

  it('performs upkeep on first eligible wallet and throttles', async () => {
    const { automator, w1, w2 } = await deploy();
    await w1.setNeedsUpkeep(true);
    const [needed, performData] = await automator.checkUpkeep('0x');
    expect(needed).to.eq(true);

    const tx = await automator.performUpkeep(performData);
    await tx.wait();

    expect(await w1.needsUpkeep()).to.eq(false);

    const [needed2] = await automator.checkUpkeep('0x');
    expect(needed2).to.eq(false);
  });

  it('skips closed or paused wallets', async () => {
    const { automator, w1, w2 } = await deploy();
    await w1.setClosed(true);
    await w2.setAutomationPaused(true);
    await w1.setNeedsUpkeep(true);
    await w2.setNeedsUpkeep(true);

    const [needed] = await automator.checkUpkeep('0x');
    expect(needed).to.eq(false);
  });

  it('respects maxWalletsPerScan limit', async () => {
    const { automator, w1 } = await deploy();
    await automator.setScanLimits(1, 0);
    await w1.setNeedsUpkeep(true);
    const [needed] = await automator.checkUpkeep('0x');
    expect(needed).to.eq(true);
  });

  it('advances start index by checked count when none found', async () => {
    const { automator, factory } = await deploy();
    const W = await ethers.getContractFactory('MockPowerWallet');
    const extra1 = await W.deploy();
    // @ts-ignore
    if (typeof (extra1 as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (extra1 as any).waitForDeployment();
    }
    const extra2 = await W.deploy();
    // @ts-ignore
    if (typeof (extra2 as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (extra2 as any).waitForDeployment();
    }

    const [ , , , user3 ] = await ethers.getSigners();
    await factory.addUser(user3.address);
    const extra1Addr = typeof (extra1 as any).getAddress === 'function' ? await (extra1 as any).getAddress() : (extra1 as any).address;
    const extra2Addr = typeof (extra2 as any).getAddress === 'function' ? await (extra2 as any).getAddress() : (extra2 as any).address;
    await factory.addWallet(user3.address, extra1Addr);
    await factory.addWallet(user3.address, extra2Addr);

    await automator.setScanLimits(2, 0);
    await automator.setMinSecondsBetweenRuns(0);
    await automator.performUpkeep('0x');
    const startIdx = await automator.startIdxWalletsPerScan();
    expect(startIdx).to.eq(2n);
  });

  it('advances start index by checked+1 when upkeep performed', async () => {
    const { automator, factory } = await deploy();
    const W = await ethers.getContractFactory('MockPowerWallet');
    const wA = await W.deploy();
    // @ts-ignore
    if (typeof (wA as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (wA as any).waitForDeployment();
    }
    const wB = await W.deploy();
    // @ts-ignore
    if (typeof (wB as any).waitForDeployment === 'function') {
      // @ts-ignore
      await (wB as any).waitForDeployment();
    }

    const [ , , , user3 ] = await ethers.getSigners();
    await factory.addUser(user3.address);
    const wAAddr = typeof (wA as any).getAddress === 'function' ? await (wA as any).getAddress() : (wA as any).address;
    const wBAddr = typeof (wB as any).getAddress === 'function' ? await (wB as any).getAddress() : (wB as any).address;
    await factory.addWallet(user3.address, wAAddr);
    await factory.addWallet(user3.address, wBAddr);
    await wB.setNeedsUpkeep(true);

    // Start scanning at index 2 (the new pair), limit 2 so wB is second in partition
    await automator.setScanLimits(2, 2);
    await automator.setMinSecondsBetweenRuns(0);
    await automator.performUpkeep('0x');
    const startIdx = await automator.startIdxWalletsPerScan();
    // checked before match = 1, advance by 1+1 => 2; (2+2) % total(=4) => 0
    expect(startIdx).to.eq(0n);
  });
});



export type SimpleUpkeep = {
  name: string;
  address: string;
};

export type ChainConfig = {
  name: string;
  chainId: number;
  rpcEnv: string;
  defaultRpc: string;
  automator: string;
  /** Serviced by the frequent upkeep-* schedules (not TechnicalIndicators). */
  frequentUpkeeps: SimpleUpkeep[];
  /** Serviced only by indicators-daily inside the UTC midnight window. */
  technicalIndicators: SimpleUpkeep;
};

export const CHAINS = {
  base: {
    name: "base",
    chainId: 8453,
    rpcEnv: "BASE_RPC_URL",
    defaultRpc: "https://mainnet.base.org",
    automator: process.env.AUTOMATOR_BASE || "0x05b9079458D57F80e6638cF0ABaFd31BfBa0f586",
    frequentUpkeeps: [],
    technicalIndicators: {
      name: "TechnicalIndicators",
      address: process.env.TI_BASE || "0xE0087A5EcAaF884894946191eb9d5FD0841D95Ec",
    },
  },
  "base-sepolia": {
    name: "base-sepolia",
    chainId: 84532,
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    defaultRpc: "https://sepolia.base.org",
    automator: process.env.AUTOMATOR_BASE_SEPOLIA || "0x79cec041e963526122ffC7C04F427595a132331B",
    frequentUpkeeps: [
      {
        name: "PoolRebalancer",
        address:
          process.env.REBALANCER_BASE_SEPOLIA || "0xCbad841061ea2cFD74f0adF2F06488596138B4A9",
      },
    ],
    technicalIndicators: {
      name: "TechnicalIndicators",
      address:
        process.env.TI_BASE_SEPOLIA || "0x7A0F3B371A2563627EfE1967E7645812909Eb6c5",
    },
  },
} as const satisfies Record<string, ChainConfig>;

export type ChainKey = keyof typeof CHAINS;

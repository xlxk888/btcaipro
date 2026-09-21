// Only factories listed by the protocol maintainers are enabled. Other DEXes can
// be added here after their deployments and event ABI have been verified.
// https://developers.uniswap.org/docs/protocols/v2/deployments
// https://docs.pancakeswap.finance/italian/code/smart-contracts/pancakeswap-exchange/factory-v2
export const DEX_REGISTRY = Object.freeze([
  ['ethereum', 1, '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', 'Uniswap V2'],
  ['bsc', 56, '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', 'PancakeSwap V2'],
  ['arbitrum', 42161, '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9', 'Uniswap V2'],
  ['base', 8453, '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', 'Uniswap V2'],
  ['polygon', 137, '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C', 'Uniswap V2'],
  ['avalanche', 43114, '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C', 'Uniswap V2'],
  ['robinhood', 4663, '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', 'Uniswap V2', 'v2'],
  // https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments
  ['robinhood', 4663, '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', 'Uniswap V3', 'v3']
].map(([chain, chainId, factoryAddress, dexName, version = 'v2']) => Object.freeze({
  chain, chainId, dexId: dexName === 'PancakeSwap V2' ? 'pancakeswap-v2' : `uniswap-${version}`,
  dexName, factoryAddress, poolType: version, enabled: true,
  eventSignatures: version === 'v3' ? ['PoolCreated', 'Mint', 'Swap'] : ['PairCreated', 'Sync', 'Swap']
})));

export const DISCOVERY_CHAINS = Object.freeze({
  ethereum: { chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com' },
  bsc: { chainId: 56, rpc: 'https://bsc-dataseed.binance.org' },
  arbitrum: { chainId: 42161, rpc: 'https://arb1.arbitrum.io/rpc' },
  base: { chainId: 8453, rpc: 'https://mainnet.base.org' },
  polygon: { chainId: 137, rpc: 'https://polygon-rpc.com' },
  avalanche: { chainId: 43114, rpc: 'https://api.avax.network/ext/bc/C/rpc' },
  robinhood: { chainId: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com' },
  // No confirmed V2 factory has been configured for HyperEVM yet.
  hyperliquid: { chainId: 999, rpc: 'https://rpc.hyperliquid.xyz/evm', status: 'pending-factory' },
  solana: { rpc: 'https://api.mainnet-beta.solana.com', status: 'limited' },
  tron: { status: 'limited' }
});

export const PAIR_CREATED = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
export const SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613d26f18c5d8114c9e7a0d5c5b5d9e';
export const SYNC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';
export const POOL_CREATED = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118';
export const V3_SWAP = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
export const V3_MINT = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde';
// https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/lib.rs
// PoolState layout: https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/states/pool.rs
export const RAYDIUM_CPMM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

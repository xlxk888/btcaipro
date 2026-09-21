(function (root) {
  'use strict';

  const chains = [
    { id: 'ethereum', name: 'Ethereum', type: 'evm', chainId: 1, nativeAsset: 'ETH', rpc: ['https://ethereum-rpc.publicnode.com'], explorer: 'https://etherscan.io', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true } },
    { id: 'bsc', name: 'BNB Smart Chain / BSC', type: 'evm', chainId: 56, nativeAsset: 'BNB', rpc: ['https://bsc-dataseed.binance.org'], explorer: 'https://bscscan.com', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true } },
    { id: 'arbitrum', name: 'Arbitrum One', type: 'evm', chainId: 42161, nativeAsset: 'ETH', rpc: ['https://arb1.arbitrum.io/rpc'], explorer: 'https://arbiscan.io', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true } },
    { id: 'base', name: 'Base', type: 'evm', chainId: 8453, nativeAsset: 'ETH', rpc: ['https://mainnet.base.org'], explorer: 'https://basescan.org', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true } },
    { id: 'polygon', name: 'Polygon', type: 'evm', chainId: 137, nativeAsset: 'POL', rpc: ['https://polygon-rpc.com'], explorer: 'https://polygonscan.com', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true } },
    { id: 'avalanche', name: 'Avalanche C-Chain', type: 'evm', chainId: 43114, nativeAsset: 'AVAX', rpc: ['https://api.avax.network/ext/bc/C/rpc'], explorer: 'https://snowtrace.io', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true } },
    { id: 'robinhood', name: 'Robinhood Chain', type: 'evm', chainId: 4663, nativeAsset: 'ETH', rpc: ['https://rpc.mainnet.chain.robinhood.com'], explorer: 'https://robinhoodchain.blockscout.com', addressType: 'evm-contract', enabled: true, capabilities: { metadata: true, marketData: true, rateLimitedRpc: true } },
    { id: 'solana', name: 'Solana', type: 'solana', chainId: null, nativeAsset: 'SOL', rpc: ['https://api.mainnet-beta.solana.com'], explorer: 'https://explorer.solana.com', addressType: 'mint', enabled: true, capabilities: { metadata: 'decimals-only', marketData: true } },
    { id: 'tron', name: 'Tron', type: 'tron', chainId: null, nativeAsset: 'TRX', rpc: [], explorer: 'https://tronscan.org', addressType: 'trc20-contract', enabled: true, capabilities: { metadata: false, marketData: false } },
    { id: 'bitcoin', name: 'Bitcoin', type: 'bitcoin', chainId: null, nativeAsset: 'BTC', rpc: [], explorer: 'https://mempool.space', addressType: 'native-only', enabled: true, capabilities: { metadata: false, marketData: true, ordinals: false, runes: false } }
  ];
  const byChain = Object.fromEntries(chains.map(chain => [chain.id, chain]));

  // A symbol is a search alias only. Market data is bound to this canonical ID.
  const canonical = [
    ['bitcoin', 'BTC', 'Bitcoin', 'BTCUSDT', 'bitcoin', 'bitcoin:BTC'],
    ['ethereum', 'ETH', 'Ethereum', 'ETHUSDT', 'ethereum', 'evm:1:native'],
    ['uniswap', 'UNI', 'Uniswap', 'UNIUSDT', 'uniswap', 'canonical:uniswap'],
    ['zcash', 'ZEC', 'Zcash', 'ZECUSDT', 'zcash', 'canonical:zcash'],
    ['hyperliquid', 'HYPE', 'Hyperliquid', 'HYPEUSDT', 'hyperliquid', 'hyperliquid:HYPE'],
    ['tether', 'USDT', 'Tether', 'USDTUSDT', 'tether', 'canonical:tether'],
    ['usd-coin', 'USDC', 'USD Coin', 'USDCUSDT', 'usd-coin', 'canonical:usd-coin'],
    ['dai', 'DAI', 'Dai', 'DAIUSDT', 'dai', 'canonical:dai'],
    ['first-digital-usd', 'FDUSD', 'First Digital USD', 'FDUSDUSDT', 'first-digital-usd', 'canonical:first-digital-usd'],
    ['true-usd', 'TUSD', 'TrueUSD', 'TUSDUSDT', 'true-usd', 'canonical:true-usd'],
    ['binancecoin', 'BNB', 'BNB', 'BNBUSDT', 'binancecoin', 'canonical:binancecoin'],
    ['solana', 'SOL', 'Solana', 'SOLUSDT', 'solana', 'canonical:solana'],
    ['monero', 'XMR', 'Monero', 'XMRUSDT', 'monero', 'canonical:monero'],
    ['dogecoin', 'DOGE', 'Dogecoin', 'DOGEUSDT', 'dogecoin', 'canonical:dogecoin'],
    ['ripple', 'XRP', 'XRP', 'XRPUSDT', 'ripple', 'canonical:ripple'],
    ['cardano', 'ADA', 'Cardano', 'ADAUSDT', 'cardano', 'canonical:cardano'],
    ['avalanche-2', 'AVAX', 'Avalanche', 'AVAXUSDT', 'avalanche-2', 'canonical:avalanche'],
    ['polkadot', 'DOT', 'Polkadot', 'DOTUSDT', 'polkadot', 'canonical:polkadot'],
    ['chainlink', 'LINK', 'Chainlink', 'LINKUSDT', 'chainlink', 'canonical:chainlink'],
    ['the-open-network', 'TON', 'Toncoin', 'TONUSDT', 'the-open-network', 'canonical:toncoin'],
    ['tron', 'TRX', 'TRON', 'TRXUSDT', 'tron', 'canonical:tron'],
    ['polygon-ecosystem-token', 'POL', 'POL', 'POLUSDT', 'polygon-ecosystem-token', 'canonical:polygon'],
    ['arbitrum', 'ARB', 'Arbitrum', 'ARBUSDT', 'arbitrum', 'canonical:arbitrum'],
    ['optimism', 'OP', 'Optimism', 'OPUSDT', 'optimism', 'canonical:optimism'],
    ['pepe', 'PEPE', 'Pepe', 'PEPEUSDT', 'pepe', 'canonical:pepe'],
    ['shiba-inu', 'SHIB', 'Shiba Inu', 'SHIBUSDT', 'shiba-inu', 'canonical:shiba-inu'],
    ['aave', 'AAVE', 'Aave', 'AAVEUSDT', 'aave', 'canonical:aave'],
    ['litecoin', 'LTC', 'Litecoin', 'LTCUSDT', 'litecoin', 'canonical:litecoin'],
    ['bitcoin-cash', 'BCH', 'Bitcoin Cash', 'BCHUSDT', 'bitcoin-cash', 'canonical:bitcoin-cash'],
    ['ethereum-classic', 'ETC', 'Ethereum Classic', 'ETCUSDT', 'ethereum-classic', 'canonical:ethereum-classic'],
    ['cosmos', 'ATOM', 'Cosmos', 'ATOMUSDT', 'cosmos', 'canonical:cosmos'],
    ['near', 'NEAR', 'NEAR Protocol', 'NEARUSDT', 'near', 'canonical:near'],
    ['aptos', 'APT', 'Aptos', 'APTUSDT', 'aptos', 'canonical:aptos'],
    ['sui', 'SUI', 'Sui', 'SUIUSDT', 'sui', 'canonical:sui'],
    ['filecoin', 'FIL', 'Filecoin', 'FILUSDT', 'filecoin', 'canonical:filecoin'],
    ['injective-protocol', 'INJ', 'Injective', 'INJUSDT', 'injective-protocol', 'canonical:injective'],
    ['dogwifcoin', 'WIF', 'dogwifhat', 'WIFUSDT', 'dogwifcoin', 'canonical:dogwifhat'],
    ['ethena', 'ENA', 'Ethena', 'ENAUSDT', 'ethena', 'canonical:ethena'],
    ['ondo-finance', 'ONDO', 'Ondo', 'ONDOUSDT', 'ondo-finance', 'canonical:ondo'],
    ['render-token', 'RENDER', 'Render', 'RENDERUSDT', 'render-token', 'canonical:render']
  ].map(([canonicalAssetId, symbol, name, pair, marketDataId, id]) => ({ canonicalAssetId, symbol, name, pair, marketDataId, id, assetType: id === 'bitcoin:BTC' ? 'native' : 'canonical' }));
  const byAlias = new Map();
  canonical.forEach(asset => {
    [asset.symbol, asset.name, asset.pair].forEach(alias => byAlias.set(alias.toUpperCase(), asset));
  });
  const byCanonicalId = Object.fromEntries(canonical.map(asset => [asset.canonicalAssetId, asset]));
  const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function decodeBase58(value) {
    let number = 0n;
    for (const char of value) {
      const digit = base58.indexOf(char);
      if (digit < 0) throw new Error('地址不是有效 Base58 格式');
      number = number * 58n + BigInt(digit);
    }
    const bytes = [];
    while (number > 0n) {
      bytes.unshift(Number(number % 256n));
      number /= 256n;
    }
    for (const char of value) {
      if (char !== '1') break;
      bytes.unshift(0);
    }
    return Uint8Array.from(bytes);
  }

  function identity(chain, address) {
    if (chain.type === 'evm') return `evm:${chain.chainId}:${address.toLowerCase()}`;
    if (chain.type === 'solana') return `solana:${address}`;
    if (chain.type === 'tron') return `tron:${address}`;
    return 'bitcoin:BTC';
  }

  async function rpc(url, method, params, fetcher) {
    const response = await fetcher(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error || payload.result === undefined || payload.result === null) throw new Error(`RPC ${method} 无有效结果`);
    return payload.result;
  }

  function decodeEvmString(hex) {
    if (!/^0x[0-9a-fA-F]+$/.test(hex)) return '';
    const bytes = Uint8Array.from((hex.slice(2).match(/.{2}/g) || []).map(part => parseInt(part, 16)));
    let content = bytes;
    if (bytes.length >= 64) {
      const offset = Number(BigInt(`0x${hex.slice(2, 66)}`));
      if (offset + 32 <= bytes.length) {
        const length = Number(BigInt(`0x${hex.slice(2 + offset * 2, 2 + (offset + 32) * 2)}`));
        if (length >= 0 && offset + 32 + length <= bytes.length) content = bytes.slice(offset + 32, offset + 32 + length);
      }
    }
    return new TextDecoder().decode(content).replace(/\0+$/g, '').trim();
  }

  const adapters = {
    evm: {
      validate(address) { return /^0x[0-9a-fA-F]{40}$/.test(address); },
      async metadata(chain, address, fetcher) {
        let lastError;
        for (const url of chain.rpc) {
          try {
            const actualChain = Number(BigInt(await rpc(url, 'eth_chainId', [], fetcher)));
            if (actualChain !== chain.chainId) throw new Error('RPC chainId 与所选链不一致');
            const call = data => rpc(url, 'eth_call', [{ to: address, data }, 'latest'], fetcher);
            const [nameHex, symbolHex, decimalsHex] = await Promise.all([
              call('0x06fdde03'), call('0x95d89b41'), call('0x313ce567')
            ]);
            const name = decodeEvmString(nameHex);
            const symbol = decodeEvmString(symbolHex);
            const decimals = Number(BigInt(decimalsHex));
            if (!name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('合约 metadata 不完整');
            return { name, symbol, decimals, metadataStatus: '链上已核验' };
          } catch (error) { lastError = error; }
        }
        throw new Error(`${chain.name} metadata 读取失败：${lastError?.message || 'RPC 不可用'}`);
      }
    },
    solana: {
      validate(address) {
        try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && decodeBase58(address).length === 32; }
        catch (_) { return false; }
      },
      async metadata(chain, address, fetcher) {
        try {
          const result = await rpc(chain.rpc[0], 'getAccountInfo', [address, { encoding: 'jsonParsed' }], fetcher);
          const account = result.value;
          const parsed = account?.data?.parsed;
          if (parsed?.type !== 'mint' || !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFqj8aJYjzc6XZxnGs'].includes(account?.owner)) throw new Error('地址不是 SPL Mint');
          const decimals = Number(parsed.info.decimals);
          if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Mint decimals 无效');
          return { decimals, metadataStatus: 'Mint 已核验；名称与简称来自行情源' };
        } catch (error) {
          if (error.message === '地址不是 SPL Mint' || error.message === 'Mint decimals 无效') throw error;
          throw new Error(`Solana Mint 核验失败：${error.message}`);
        }
      }
    },
    tron: {
      async validate(address, subtle) {
        if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
        try {
          const bytes = decodeBase58(address);
          if (bytes.length !== 25 || bytes[0] !== 0x41) return false;
          const first = await subtle.digest('SHA-256', bytes.slice(0, 21));
          const second = new Uint8Array(await subtle.digest('SHA-256', first));
          return bytes.slice(21).every((byte, index) => byte === second[index]);
        } catch (_) { return false; }
      },
      async metadata() { return { decimals: null, metadataStatus: 'Tron 地址校验通过；合约类型与资料未核验' }; }
    },
    bitcoin: {
      validate() { return false; },
      async metadata() { throw new Error('Bitcoin 仅支持 BTC 原生资产，地址不是 Token 合约'); }
    }
  };

  root.CryptoAIAssets = Object.freeze({ chains, byChain, canonical, byCanonicalId, search: input => byAlias.get(input.trim().toUpperCase()), identity, adapters });
})(typeof window !== 'undefined' ? window : globalThis);

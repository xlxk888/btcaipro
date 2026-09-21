import { DEX_REGISTRY, DISCOVERY_CHAINS, PAIR_CREATED, POOL_CREATED, SWAP, SYNC, V3_SWAP, V3_MINT, RAYDIUM_CPMM } from './registry.js';
import { encodeBase58 } from './base58.js';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const wordAddress = hex => `0x${hex.slice(-40).toLowerCase()}`;

export class ChainDiscoveryAdapter {
  constructor({ chain, repository, fetchImpl = fetch, timeoutMs = 6_000, rpcUrls }) {
    this.chain = chain;
    this.repository = repository;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.rpcUrls = rpcUrls?.length ? rpcUrls : [DISCOVERY_CHAINS[chain].rpc].filter(Boolean);
    this.rpcIndex = 0;
  }

  async rpc(method, params = []) {
    let lastError;
    for (let attempt = 0; attempt < this.rpcUrls.length; attempt++) {
      const index = (this.rpcIndex + attempt) % this.rpcUrls.length;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.rpcUrls[index], {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal
        });
        if (!response.ok) throw new Error(`${this.chain} ${method}: HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.error) throw new Error(`${this.chain} ${method}: ${payload.error.message}`);
        this.rpcIndex = index;
        return payload.result;
      } catch (error) { lastError = error; }
      finally { clearTimeout(timer); }
    }
    throw lastError || new Error(`${this.chain} RPC endpoint unavailable`);
  }
}

function decodeString(hex) {
  if (!/^0x(?:[\da-f]{2})*$/i.test(hex || '')) return '';
  const bytes = Buffer.from(hex.slice(2), 'hex');
  let content = bytes;
  if (bytes.length >= 64) {
    const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
    if (offset === 32 && bytes.length >= 64) {
      const length = Number(BigInt(`0x${bytes.subarray(32, 64).toString('hex')}`));
      if (length <= 256 && bytes.length >= 64 + length) content = bytes.subarray(64, 64 + length);
    }
  }
  return content.toString('utf8').replace(/\0+$/, '').trim().slice(0, 128);
}

export class EvmDiscoveryAdapter extends ChainDiscoveryAdapter {
  constructor(options) {
    super(options);
    this.factories = (options.factories || DEX_REGISTRY).filter(dex => dex.chain === this.chain && dex.enabled);
    this.windowBlocks = options.windowBlocks || 400;
    this.lookbackBlocks = options.lookbackBlocks || 1600;
  }

  async call(to, data) { return this.rpc('eth_call', [{ to, data }, 'latest']); }

  async blockTime(blockNumber) {
    const block = await this.rpc('eth_getBlockByNumber', [blockNumber, false]);
    return block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : null;
  }

  async metadata(address) {
    if (!ADDRESS.test(address)) throw new Error('Invalid EVM address');
    const code = await this.rpc('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') throw new Error('Token contract absent');
    const [nameHex, symbolHex, decimalsHex] = await Promise.all([
      this.call(address, '0x06fdde03'), this.call(address, '0x95d89b41'), this.call(address, '0x313ce567')
    ]);
    const name = decodeString(nameHex), symbol = decodeString(symbolHex);
    const decimals = Number(BigInt(decimalsHex));
    if (!name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Incomplete token metadata');
    return { name, symbol, decimals, verifiedOnChain: true };
  }

  async refreshPool(pool, tip) {
    const fromBlock = Math.max(pool.createdBlock || 0, tip - this.lookbackBlocks);
    const hexRange = { address: pool.poolAddress, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${tip.toString(16)}` };
    const v3 = pool.poolType === 'v3';
    const [reserves, swaps, syncs] = await Promise.all([
      this.call(pool.poolAddress, v3 ? '0x1a686502' : '0x0902f1ac'),
      this.rpc('eth_getLogs', [{ ...hexRange, topics: [v3 ? V3_SWAP : SWAP] }]),
      this.rpc('eth_getLogs', [{ ...hexRange, topics: [v3 ? V3_MINT : SYNC] }])
    ]);
    const reserve0 = BigInt(`0x${reserves.slice(2, 66)}`);
    const reserve1 = v3 ? reserve0 : BigInt(`0x${reserves.slice(66, 130)}`);
    const active = reserve0 > 0n && reserve1 > 0n;
    const liquidity = v3 ? [reserve0.toString()] : [reserve0.toString(), reserve1.toString()];
    const firstObservedSwapAt = swaps.length ? await this.blockTime(swaps[0].blockNumber) : null;
    const lastSwapAt = swaps.length ? await this.blockTime(swaps.at(-1).blockNumber) : null;
    return this.repository.upsertPool({ ...pool, latestLiquidity: liquidity,
      initialLiquidity: pool.initialLiquidity || (active ? liquidity : null),
      liquidityPositive: active, liquidityChangedAt: syncs.length ? Date.now() : pool.liquidityChangedAt || null,
      firstSwapAt: pool.firstSwapAt || firstObservedSwapAt,
      lastSwapAt: lastSwapAt || pool.lastSwapAt || null,
      verifiedOnChain: true });
  }

  // A market index can suggest an older pool; identity is accepted only after
  // checking the pool factory, both tokens, reserves/liquidity and Swap on RPC.
  async verifySuggestedPool(pair, tip) {
    const poolAddress = pair.poolAddress || pair.pairAddress;
    if (!ADDRESS.test(poolAddress || '')) return null;
    const factoryAddress = wordAddress(await this.call(poolAddress, '0xc45a0155'));
    const factory = this.factories.find(item => item.factoryAddress.toLowerCase() === factoryAddress);
    if (!factory) return null;
    const [token0, token1] = await Promise.all(['0x0dfe1681', '0xd21220a7'].map(async selector => wordAddress(await this.call(poolAddress, selector))));
    if (![token0, token1].every(value => ADDRESS.test(value))) return null;
    const encodedTokens = `${token0.slice(2).padStart(64, '0')}${token1.slice(2).padStart(64, '0')}`;
    const fee = factory.poolType === 'v3' ? BigInt(await this.call(poolAddress, '0xddca3f43')) : null;
    const selector = factory.poolType === 'v3' ? '0x1698ee82' : '0xe6a43905';
    const resolved = wordAddress(await this.call(factory.factoryAddress,
      `${selector}${encodedTokens}${fee === null ? '' : fee.toString(16).padStart(64, '0')}`));
    if (resolved !== poolAddress.toLowerCase()) return null;
    const pool = this.repository.upsertPool({ chain: this.chain, chainId: factory.chainId,
      poolAddress, token0, token1, factoryAddress, dexId: factory.dexId, dexName: factory.dexName,
      poolType: factory.poolType, createdBlock: null, createdAt: null,
      discoveredAt: Date.now() });
    const updated = await this.refreshPool(pool, tip);
    if (!updated.liquidityPositive || !updated.firstSwapAt) return null;
    updated.lastCheckedAt = Date.now();
    await this.indexPoolTokens(updated);
    return updated;
  }

  async indexPoolTokens(pool) {
    for (const contractAddress of [pool.token0, pool.token1]) {
      const id = `evm:${factoryChainId(this.chain)}:${contractAddress}`;
      if (this.repository.assets.get(id)?.verifiedOnChain) continue;
      try { this.repository.upsertAsset({ chain: this.chain, chainId: factoryChainId(this.chain), contractAddress,
        ...await this.metadata(contractAddress) }); } catch (_) { /* Some pool tokens are not ERC20. */ }
    }
  }

  async poll() {
    if (!this.factories.length) return { chain: this.chain, status: 'pending-factory', pools: 0 };
    const actualChainId = Number(BigInt(await this.rpc('eth_chainId')));
    if (actualChainId !== DISCOVERY_CHAINS[this.chain].chainId) throw new Error(`${this.chain}: RPC chain ID mismatch`);
    const tip = Number(BigInt(await this.rpc('eth_blockNumber')));
    let seen = 0;
    for (const factory of this.factories) {
      const key = `${factory.chainId}:${factory.factoryAddress.toLowerCase()}`;
      const start = this.repository.cursors.has(key)
        ? this.repository.cursors.get(key) + 1 : Math.max(0, tip - this.lookbackBlocks);
      const end = Math.min(tip, start + this.windowBlocks - 1);
      if (start <= end) {
        const logs = await this.rpc('eth_getLogs', [{ address: factory.factoryAddress,
          fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`,
          topics: [factory.poolType === 'v3' ? POOL_CREATED : PAIR_CREATED] }]);
        for (const log of logs) {
          const token0 = wordAddress(log.topics[1]);
          const token1 = wordAddress(log.topics[2]);
          const poolAddress = wordAddress(factory.poolType === 'v3' ? log.data.slice(66, 130) : log.data.slice(2, 66));
          if (![token0, token1, poolAddress].every(address => ADDRESS.test(address))) continue;
          this.repository.upsertPool({ chain: this.chain, chainId: factory.chainId, token0, token1,
            poolAddress, dexId: factory.dexId, dexName: factory.dexName,
            factoryAddress: factory.factoryAddress.toLowerCase(), poolType: factory.poolType,
            createdBlock: Number(BigInt(log.blockNumber)),
            createdAt: await this.blockTime(log.blockNumber),
            initialLiquidity: null, latestLiquidity: null, firstSwapAt: null, lastSwapAt: null });
          seen++;
        }
        this.repository.cursors.set(key, end);
      }
    }
    const pools = [...this.repository.pools.values()].filter(pool => pool.chain === this.chain &&
      (!pool.lastCheckedAt || Date.now() - pool.lastCheckedAt > 60_000)).slice(0, 12);
    for (const pool of pools) {
      try {
        const updated = await this.refreshPool(pool, tip);
        updated.lastCheckedAt = Date.now();
        if (!updated.liquidityPositive || !updated.firstSwapAt) continue;
        await this.indexPoolTokens(updated);
      } catch (_) { /* Retry this pool on a future poll. */ }
    }
    await this.repository.persist();
    return { chain: this.chain, status: 'indexed', pools: seen };
  }
}

const factoryChainId = chain => DISCOVERY_CHAINS[chain].chainId;

// Solana mint validation is independent of EVM contracts. Pool indexing remains
// limited until an RPC pool-program decoder is configured and verified.
export class SolanaDiscoveryAdapter extends ChainDiscoveryAdapter {
  async verifyMint(mintAddress) {
    if (!MINT.test(mintAddress)) return null;
    const info = (await this.rpc('getAccountInfo', [mintAddress, { encoding: 'jsonParsed' }]))?.value;
    if (!['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFqj8aJYjzc6XZxnGs'].includes(info?.owner) || info?.data?.parsed?.type !== 'mint') return null;
    return { chain: 'solana', chainId: 'solana', mintAddress,
      decimals: info.data.parsed.info.decimals, verifiedOnChain: true };
  }
  async readPool(poolAddress) {
    const account = (await this.rpc('getAccountInfo', [poolAddress, { encoding: 'base64' }]))?.value;
    if (account?.owner !== RAYDIUM_CPMM || !Array.isArray(account.data)) return null;
    const data = Buffer.from(account.data[0], 'base64');
    if (data.length < 637) return null;
    // Anchor discriminator (8), then amm_config, creator, vault0, vault1,
    // LP mint, mint0, mint1 (32 bytes each); see Raydium PoolState.
    const key = offset => encodeBase58(data.subarray(offset, offset + 32));
    return { chain: 'solana', poolAddress, token0: key(168), token1: key(200),
      vault0: key(72), vault1: key(104), dexName: 'Raydium CPMM', dexId: 'raydium-cpmm',
      poolType: 'cpmm', verifiedOnChain: true };
  }

  async refreshPool(pool) {
    const [balance0, balance1, signatures] = await Promise.all([
      this.rpc('getTokenAccountBalance', [pool.vault0]), this.rpc('getTokenAccountBalance', [pool.vault1]),
      this.rpc('getSignaturesForAddress', [pool.poolAddress, { limit: 12 }])
    ]);
    const liquidityPositive = BigInt(balance0.value.amount) > 0n && BigInt(balance1.value.amount) > 0n;
    let swapAt = pool.firstSwapAt || null;
    if (!swapAt && liquidityPositive) {
      for (const signature of signatures.slice(0, 6)) {
        if (signature.err) continue;
        const transaction = await this.rpc('getTransaction', [signature.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
        if (transaction?.meta?.logMessages?.some(line => /Program log: Instruction: SwapBase(Input|Output)/.test(line)) &&
            transaction?.transaction?.message?.instructions?.some(instruction => instruction.programId === RAYDIUM_CPMM && instruction.accounts?.includes(pool.poolAddress))) {
          swapAt = transaction.blockTime ? transaction.blockTime * 1000 : Date.now();
          break;
        }
      }
    }
    return this.repository.upsertPool({ ...pool,
      latestLiquidity: [balance0.value.amount, balance1.value.amount],
      initialLiquidity: pool.initialLiquidity || (liquidityPositive ? [balance0.value.amount, balance1.value.amount] : null),
      liquidityPositive, firstSwapAt: swapAt, lastSwapAt: swapAt,
      lastCheckedAt: Date.now() });
  }

  async poll() {
    const signatures = await this.rpc('getSignaturesForAddress', [RAYDIUM_CPMM, { limit: 30 }]);
    const cursor = this.repository.cursors.get('solana:raydium-cpmm');
    const fresh = [];
    for (const signature of signatures) {
      if (signature.signature === cursor) break;
      if (!signature.err) fresh.push(signature);
    }
    const pendingKey = 'solana:raydium-cpmm:pending';
    const queue = [...(this.repository.cursors.get(pendingKey) || []), ...fresh.reverse()];
    const batch = queue.splice(0, 8);
    let count = 0;
    for (const signature of batch) {
      let transaction;
      try { transaction = await this.rpc('getTransaction', [signature.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]); }
      catch (_) { continue; }
      if (!transaction?.meta?.logMessages?.some(line => /Program log: Instruction: Initialize(?:WithPermission)?$/.test(line))) continue;
      const instructions = transaction.transaction?.message?.instructions || [];
      for (const instruction of instructions) {
        if (instruction.programId !== RAYDIUM_CPMM || !instruction.accounts?.[3]) continue;
        const pool = await this.readPool(instruction.accounts[3]);
        if (!pool) continue;
        this.repository.upsertPool({ ...pool, createdAt: transaction.blockTime ? transaction.blockTime * 1000 : null,
          discoveredAt: Date.now() });
        count++;
      }
    }
    if (signatures[0]) this.repository.cursors.set('solana:raydium-cpmm', signatures[0].signature);
    this.repository.cursors.set(pendingKey, queue.slice(-200));
    for (const pool of [...this.repository.pools.values()].filter(item => item.chain === 'solana' &&
      (!item.lastCheckedAt || Date.now() - item.lastCheckedAt > 60_000)).slice(0, 6)) {
      try {
        const updated = await this.refreshPool(pool);
        if (!updated.liquidityPositive || !updated.firstSwapAt) continue;
        for (const mintAddress of [pool.token0, pool.token1]) {
          const minted = await this.verifyMint(mintAddress);
          if (minted) this.repository.upsertAsset(minted);
        }
      } catch (_) { /* A rejected RPC request is retried during the next poll. */ }
    }
    await this.repository.persist();
    return { chain: 'solana', status: 'limited-recent-raydium-cpmm', pools: count };
  }
}

export class TronDiscoveryAdapter extends ChainDiscoveryAdapter {
  async poll() { return { chain: 'tron', status: 'limited', pools: 0 }; }
}

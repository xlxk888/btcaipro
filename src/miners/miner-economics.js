const HASHES_PER_TH = 1e12;
const DIFFICULTY_UNIT = 2 ** 32;
const SECONDS_PER_DAY = 86_400;

export function calculateMinerEconomics({ hashrateTH, powerW, difficulty, blockReward = 3.125, feeReward = 0, btcPrice, electricityUsdPerKwh }) {
  const values = { hashrateTH, powerW, difficulty, blockReward, feeReward, btcPrice, electricityUsdPerKwh };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new TypeError(`Invalid miner economics input: ${name}`);
  }
  if (!(Number(hashrateTH) > 0) || !(Number(difficulty) > 0)) throw new TypeError('Hashrate and difficulty must be positive');
  const btcPerDay = (Number(hashrateTH) * HASHES_PER_TH * SECONDS_PER_DAY / (Number(difficulty) * DIFFICULTY_UNIT)) * (Number(blockReward) + Number(feeReward));
  const electricityKwhPerDay = Number(powerW) * 24 / 1000;
  const electricityCostUsdPerDay = electricityKwhPerDay * Number(electricityUsdPerKwh);
  const revenueUsdPerDay = btcPerDay * Number(btcPrice);
  const profitUsdPerDay = revenueUsdPerDay - electricityCostUsdPerDay;
  const shutdownPriceUsd = btcPerDay > 0 ? electricityCostUsdPerDay / btcPerDay : null;
  return { btcPerDay, electricityKwhPerDay, electricityCostUsdPerDay, revenueUsdPerDay, profitUsdPerDay, shutdownPriceUsd, profitable: profitUsdPerDay > 0, calculationMethod: 'difficulty_probability_v1' };
}

export function calculateShutdownPrice(input) {
  return calculateMinerEconomics({ ...input, btcPrice: Number(input.btcPrice || 0) }).shutdownPriceUsd;
}

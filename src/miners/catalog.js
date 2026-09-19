const OFFICIAL = {
  Bitmain: 'https://shop.bitmain.com/',
  MicroBT: 'https://www.microbt.com/',
  Canaan: 'https://shop.canaan.io/',
  Bitdeer: 'https://www.bitdeer.com/sealminer/'
};

const row = (id, manufacturer, model, variant, coolingType, hashrateTH, powerW, status = 'unverified', officialSource = OFFICIAL[manufacturer]) => ({
  id, manufacturer, model, variant, algorithm: 'SHA-256', coolingType, hashrateTH, powerW,
  efficiencyJTH: Number((powerW / hashrateTH).toFixed(2)), releaseDate: null, officialSource,
  sourceUpdatedAt: '2026-09-18', verifiedAt: status === 'verified' ? '2026-09-18' : null, status
});

export const MINER_CATALOG = Object.freeze([
  row('bitmain-u3s23-hyd-1160', 'Bitmain', 'Antminer U3S23', '1160T', 'hydro', 1160, 11020),
  row('bitmain-s23-hyd-380', 'Bitmain', 'Antminer S23', '380T', 'hydro', 380, 5428),
  row('microbt-m73-512', 'MicroBT', 'WhatsMiner M73', '512T', 'hydro', 512, 7424),
  row('bitdeer-a2-pro-hyd-500', 'Bitdeer', 'SEALMINER A2 Pro', '500T', 'hydro', 500, 7450, 'verified', 'https://ir.bitdeer.com/news-releases/news-release-details/bitdeer-launches-sealminer-a2-pro-bitcoin-mining-machines'),
  row('bitdeer-a2-pro-air-255', 'Bitdeer', 'SEALMINER A2 Pro', '255T', 'air', 255, 3790, 'verified', 'https://ir.bitdeer.com/news-releases/news-release-details/bitdeer-launches-sealminer-a2-pro-bitcoin-mining-machines'),
  row('bitmain-s21-plus-hyd-319', 'Bitmain', 'Antminer S21+', '319T', 'hydro', 319, 4785),
  row('bitmain-s21-pro-234', 'Bitmain', 'Antminer S21 Pro', '234T', 'air', 234, 3510),
  row('bitmain-s21-hyd-335', 'Bitmain', 'Antminer S21', '335T', 'hydro', 335, 5360),
  row('microbt-m70-310', 'MicroBT', 'WhatsMiner M70', '310T', 'air', 310, 5270),
  row('microbt-m66s-298', 'MicroBT', 'WhatsMiner M66S', '298T', 'hydro', 298, 5067),
  row('bitmain-s21-200', 'Bitmain', 'Antminer S21', '200T', 'air', 200, 3500),
  row('microbt-m60s-186', 'MicroBT', 'WhatsMiner M60S', '186T', 'air', 186, 3422),
  row('microbt-m63s-390', 'MicroBT', 'WhatsMiner M63S', '390T', 'hydro', 390, 7215),
  row('bitmain-t21-190', 'Bitmain', 'Antminer T21', '190T', 'air', 190, 3610),
  row('bitmain-s19xp-hyd-255', 'Bitmain', 'Antminer S19 XP', '255T', 'hydro', 255, 5304),
  row('bitmain-s19xp-140', 'Bitmain', 'Antminer S19 XP', '140T', 'air', 140, 3010),
  row('microbt-m50spp-150', 'MicroBT', 'WhatsMiner M50S++', '150T', 'air', 150, 3276),
  row('microbt-m50sp-140', 'MicroBT', 'WhatsMiner M50S+', '140T', 'air', 140, 3080),
  row('canaan-a1466-150', 'Canaan', 'Avalon A1466', '150T', 'air', 150, 3350),
  row('canaan-a15-194', 'Canaan', 'Avalon A15', '194T', 'air', 194, 3647, 'verified', 'https://shop.canaan.io/products/avalon-miner-a15-194t'),
  row('canaan-a16-282', 'Canaan', 'Avalon A16', '282T', 'air', 282, 3900, 'verified', 'https://shop.canaan.io/products/avalon-miner-a16-282t'),
  row('microbt-m56spp-230', 'MicroBT', 'WhatsMiner M56S++', '230T', 'hydro', 230, 5290),
  row('bitmain-s19j-pro-plus-122', 'Bitmain', 'Antminer S19j Pro+', '122T', 'air', 122, 3355),
  row('microbt-m50-118', 'MicroBT', 'WhatsMiner M50', '118T', 'air', 118, 3276),
  row('bitmain-s19-pro-110', 'Bitmain', 'Antminer S19 Pro', '110T', 'air', 110, 3250),
  row('bitmain-s19j-pro-104', 'Bitmain', 'Antminer S19j Pro', '104T', 'air', 104, 3068)
]);

export function validateMinerCatalog(catalog = MINER_CATALOG) {
  const ids = new Set();
  const errors = [];
  for (const miner of catalog) {
    if (!miner.id || ids.has(miner.id)) errors.push(`${miner.id || 'unknown'}:duplicate_or_missing_id`);
    ids.add(miner.id);
    for (const key of ['manufacturer', 'model', 'algorithm', 'coolingType', 'officialSource', 'status']) if (!miner[key]) errors.push(`${miner.id}:${key}`);
    for (const key of ['hashrateTH', 'powerW', 'efficiencyJTH']) if (!(Number(miner[key]) > 0)) errors.push(`${miner.id}:${key}`);
    if (!['verified', 'unverified', 'unsupported'].includes(miner.status)) errors.push(`${miner.id}:status`);
  }
  return { valid: errors.length === 0, errors };
}

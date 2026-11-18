export function researchFromLevels(rows) {
  return {records: Object.fromEntries(rows.map(row => [row.symbol, {
    symbol: row.symbol,
    securityId: row.symbol,
    reference: {
      present: true,
      currency: row.priceCurrency,
      iv: row.iv ? {value: Number(row.iv)} : null,
      supports: [row.s1, row.s2, row.s3, row.s4, row.s5].filter(Boolean).map(Number),
    },
  }]))};
}

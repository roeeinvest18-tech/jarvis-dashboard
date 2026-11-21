// Pure trading helpers -- no DOM, so Node tests can load them directly.
//
// Position sizing, the correlation guard and market breadth. None of this
// carries strategy: the sizing limits are the owner's own numbers, typed in
// on each device and kept in that device's localStorage only (never synced,
// never published), and the rest works on public scan output.

// Shares limited by three caps at once; says which one binds.
//   entry, stop       prices (long only: stop must be below entry)
//   portfolio         account value, for the %-of-portfolio cap
//   maxRisk           $ lost if the stop is hit
//   maxPosition       $ position size
//   maxPct            % of portfolio in one position
const SIZING_S = (typeof STRINGS !== 'undefined' ? STRINGS : require('./strings.js').STRINGS).trading.sizing;

function sizingCompute({ entry, stop, portfolio, maxRisk, maxPosition, maxPct }) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  entry = num(entry); stop = num(stop); portfolio = num(portfolio);
  maxRisk = num(maxRisk); maxPosition = num(maxPosition); maxPct = num(maxPct);
  if (!(entry > 0) || !(stop > 0)) return { error: SIZING_S.errors.noEntry };
  if (stop >= entry) return { error: SIZING_S.errors.stopAboveEntry };
  if (!(maxRisk > 0) || !(maxPosition > 0) || !(maxPct > 0)) return { error: SIZING_S.errors.noLimits };
  if (!(portfolio > 0)) return { error: SIZING_S.errors.noPortfolio };

  const riskPerShare = entry - stop;
  const caps = [
    { id: 'risk', label: SIZING_S.bindingRisk(maxRisk), shares: Math.floor(maxRisk / riskPerShare + 1e-9) },
    { id: 'position', label: SIZING_S.bindingPosition(maxPosition), shares: Math.floor(maxPosition / entry + 1e-9) },
    { id: 'portfolio', label: SIZING_S.bindingPortfolio(maxPct), shares: Math.floor((portfolio * maxPct / 100) / entry + 1e-9) },
  ];
  const binding = caps.reduce((a, b) => (b.shares < a.shares ? b : a));
  const shares = Math.max(0, binding.shares);
  return {
    shares,
    binding: binding.id,
    bindingLabel: binding.label,
    caps,
    riskPerShare,
    riskUsd: shares * riskPerShare,
    positionUsd: shares * entry,
    pctOfPortfolio: portfolio > 0 ? (shares * entry) / portfolio * 100 : null,
  };
}

// Candidates sharing an industry (preferred -- more specific) or, when
// industry is unknown, a sector ETF. Returns {ticker: {basis, peers[]}} for
// tickers with at least one peer in the list. Unknown on both counts means
// no claim either way.
function correlationPeers(records) {
  const out = {};
  const by = (key) => {
    const groups = {};
    for (const r of records) {
      const k = r[key];
      if (!k) continue;
      (groups[k] = groups[k] || []).push(r.ticker);
    }
    return groups;
  };
  const industries = by('industry');
  const sectors = by('sector_etf');
  for (const r of records) {
    const ind = r.industry && industries[r.industry].filter(t => t !== r.ticker);
    if (ind && ind.length) { out[r.ticker] = { basis: 'industry', name: r.industry, peers: ind }; continue; }
    const sec = r.sector_etf && sectors[r.sector_etf].filter(t => t !== r.ticker);
    if (sec && sec.length) out[r.ticker] = { basis: 'sector', name: r.sector_etf, peers: sec };
  }
  return out;
}

// Share of the scanned watchlist trading above its SMA150. Prefers the
// scan's own count; falls back to counting pct_SMA150 on older scans.
function breadthAboveSma150(scan) {
  if (scan && scan.breadth && scan.breadth.with_sma150) {
    return { above: scan.breadth.above_sma150, total: scan.breadth.with_sma150 };
  }
  const known = ((scan && scan.stocks) || []).filter(s => typeof s.pct_SMA150 === 'number');
  if (!known.length) return null;
  return { above: known.filter(s => s.pct_SMA150 > 0).length, total: known.length };
}

// Resolve suggested entry, stop, and target for any scanned stock. Uses
// scout.py's published trade_plans when present; otherwise derives an
// actionable fallback from the stock's price and SMA150 shelf so every
// Top 10 candidate can open a simulated demo position immediately.
function demoResolvePlan(record, stratKey) {
  const plans = (record && record.trade_plans) || {};
  const plan = (stratKey && plans[stratKey]) || plans.default;
  if (plan && typeof plan.entry === 'number' && typeof plan.stop === 'number') {
    return plan;
  }
  if (!record || typeof record.price !== 'number' || !Number.isFinite(record.price) || record.price <= 0) {
    return null;
  }
  const entry = Math.round(record.price * 100) / 100;
  const sma150Price = (typeof record.pct_SMA150 === 'number' && Number.isFinite(record.pct_SMA150) && (1 + record.pct_SMA150 / 100) > 0)
    ? record.price / (1 + record.pct_SMA150 / 100)
    : null;
  const rawStop = (sma150Price && sma150Price < entry && ((entry - sma150Price) / entry) <= 0.12)
    ? sma150Price * 0.99
    : entry * 0.95;
  const stop = Math.round(rawStop * 100) / 100;
  const risk = Math.max(0.01, entry - stop);
  const target = Math.round((entry + 2 * risk) * 100) / 100;
  return {
    entry,
    stop,
    target,
    stop_pct: Math.round(((entry - stop) / entry) * 1000) / 10,
    target_pct: Math.round(((target - entry) / entry) * 1000) / 10,
    rr_ratio: 2.0,
    worthwhile: true,
    stop_basis: (sma150Price && sma150Price < entry && ((entry - sma150Price) / entry) <= 0.12) ? 'sma150' : 'swing',
    target_basis: 'base',
    estimated: true,
  };
}

function demoEvaluatePosition(pos, latestPrice) {
  const entry = Number(pos && pos.entry) || 0;
  const shares = Number(pos && pos.shares) || 0;
  const stop = Number(pos && pos.stop) || 0;
  const target = Number(pos && pos.target) || 0;
  const price = (typeof latestPrice === 'number' && Number.isFinite(latestPrice) && latestPrice > 0)
    ? latestPrice
    : entry;
  const costUsd = shares * entry;
  const marketValueUsd = shares * price;
  const pnlUsd = marketValueUsd - costUsd;
  const pnlPct = costUsd > 0 ? (pnlUsd / costUsd) * 100 : 0;
  const riskPerShare = (stop > 0 && entry > stop) ? (entry - stop) : 0;
  const riskUsd = riskPerShare > 0 ? shares * riskPerShare : 0;
  const rMultiple = riskPerShare > 0 ? (price - entry) / riskPerShare : null;
  const toStopPct = (price > 0 && stop > 0) ? ((price - stop) / price) * 100 : 0;
  const status = (stop > 0 && price <= stop)
    ? 'stop_hit'
    : (target > 0 && price >= target ? 'target_hit' : 'open');
  return {
    ...pos,
    entry,
    shares,
    stop,
    target: target > 0 ? target : null,
    currentPrice: price,
    costUsd,
    marketValueUsd,
    pnlUsd,
    pnlPct,
    riskUsd,
    rMultiple,
    toStopPct,
    status,
  };
}

function demoEvaluatePortfolio(state, priceByTicker) {
  const startingCash = Number(state && state.startingCash) > 0 ? Number(state.startingCash) : 25000;
  const openPositions = ((state && state.positions) || []).map(p =>
    demoEvaluatePosition(p, priceByTicker ? priceByTicker[p.ticker] : null));
  const closedTrades = (state && Array.isArray(state.closed)) ? state.closed : [];
  const investedCostUsd = openPositions.reduce((a, p) => a + p.costUsd, 0);
  const openMarketValueUsd = openPositions.reduce((a, p) => a + p.marketValueUsd, 0);
  const unrealizedPnlUsd = openPositions.reduce((a, p) => a + p.pnlUsd, 0);
  const realizedPnlUsd = closedTrades.reduce((a, c) => a + (Number(c.pnlUsd) || 0), 0);
  const cashUsd = startingCash - investedCostUsd + realizedPnlUsd;
  const totalEquityUsd = cashUsd + openMarketValueUsd;
  const totalPnlUsd = totalEquityUsd - startingCash;
  const totalPnlPct = startingCash > 0 ? (totalPnlUsd / startingCash) * 100 : 0;
  const stopHitCount = openPositions.filter(p => p.status === 'stop_hit').length;
  const targetHitCount = openPositions.filter(p => p.status === 'target_hit').length;
  return {
    startingCash,
    cashUsd,
    investedCostUsd,
    openMarketValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd,
    totalEquityUsd,
    totalPnlUsd,
    totalPnlPct,
    stopHitCount,
    targetHitCount,
    openPositions,
    closedTrades,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    sizingCompute,
    correlationPeers,
    breadthAboveSma150,
    demoResolvePlan,
    demoEvaluatePosition,
    demoEvaluatePortfolio,
  };
}

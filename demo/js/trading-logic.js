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
function sizingCompute({ entry, stop, portfolio, maxRisk, maxPosition, maxPct }) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  entry = num(entry); stop = num(stop); portfolio = num(portfolio);
  maxRisk = num(maxRisk); maxPosition = num(maxPosition); maxPct = num(maxPct);
  if (!(entry > 0) || !(stop > 0)) return { error: 'Enter an entry and a stop price.' };
  if (stop >= entry) return { error: 'The stop has to be below the entry for a long position.' };
  if (!(maxRisk > 0) || !(maxPosition > 0) || !(maxPct > 0)) return { error: 'Set your three limits first.' };
  if (!(portfolio > 0)) return { error: 'Enter your portfolio value.' };

  const riskPerShare = entry - stop;
  const caps = [
    { id: 'risk', label: `max risk $${maxRisk}`, shares: Math.floor(maxRisk / riskPerShare + 1e-9) },
    { id: 'position', label: `max position $${maxPosition}`, shares: Math.floor(maxPosition / entry + 1e-9) },
    { id: 'portfolio', label: `${maxPct}% of portfolio`, shares: Math.floor((portfolio * maxPct / 100) / entry + 1e-9) },
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

if (typeof module !== 'undefined') {
  module.exports = { sizingCompute, correlationPeers, breadthAboveSma150 };
}

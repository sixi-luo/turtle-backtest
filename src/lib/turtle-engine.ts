// ─────────────────────────────────────────────────────────────────
// Turtle Trading Breakout Strategy – Backtest Engine
// ─────────────────────────────────────────────────────────────────

/* ── Data Types ────────────────────────────────────────────────── */

export interface OHLCV {
  date: string;       // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestParams {
  symbol: string;
  initialCapital: number;      // e.g. 100 000
  commissionRate: number;      // e.g. 0.001  (0.1 %)
  stampDutyRate: number;       // e.g. 0.001  (0.1 % A-share sell)
  system: 1 | 2;              // System 1 or System 2
  breakoutPeriod: number;      // 20 (Sys-1) or 55 (Sys-2)
  exitPeriod: number;          // 10 (Sys-1) or 20 (Sys-2)
  atrPeriod: number;           // typically 20
  stopLossMultiplier: number;  // 2 (price = peak − 2·N)
  addIntervalMultiplier: number; // 0.5 N per add level
  maxUnits: number;            // 4
  riskPerTrade: number;        // 0.01 → 1 % of capital per unit
}

export interface Trade {
  id: number;
  type: 'buy' | 'sell';
  date: string;
  price: number;
  shares: number;
  unitIndex: number;     // 0 = initial, 1 = first add …; -1 on sell (full exit)
  commission: number;
  reason: string;        // e.g. "突破20日高点入场"
}

export interface BacktestResult {
  trades: Trade[];
  equityCurve: { date: string; equity: number; benchmarkEquity: number }[];
  stats: {
    totalReturn: number;          // %
    annualizedReturn: number;     // %
    benchmarkReturn: number;      // %
    excessReturn: number;         // %
    totalTrades: number;          // completed round-trips
    winningTrades: number;
    losingTrades: number;
    winRate: number;              // %
    avgWin: number;               // %
    avgLoss: number;              // % (negative)
    profitFactor: number;         // gross-wins / gross-losses
    maxDrawdown: number;          // %
    maxDrawdownDuration: number;  // trading days
    sharpeRatio: number;
    avgHoldingDays: number;
    bestTrade: number;            // %
    worstTrade: number;           // %
    totalCommission: number;
    finalCapital: number;
  };
  signals: { date: string; type: 'buy' | 'sell'; price: number; reason: string }[];
}

/* ── Internal helpers ──────────────────────────────────────────── */

interface RoundTrip {
  entryDate: string;
  exitDate: string;
  profit: number;
  returnPct: number;
  holdingDays: number;
}

/** ATR with Wilder's smoothing. Returns `null` where the value is not yet available. */
function calculateATR(data: readonly OHLCV[], period: number): (number | null)[] {
  const n = data.length;
  const atr: (number | null)[] = new Array(n).fill(null);
  if (n < 2 || period < 1) return atr;

  // True Range for each bar
  const tr: number[] = new Array(n);
  tr[0] = data[0].high - data[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low  - data[i - 1].close),
    );
  }

  // Need at least `period` TR bars to seed
  if (n < period) return atr;

  // Seed = SMA of the first `period` TRs
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  atr[period - 1] = seed / period;

  // Wilder smoothing thereafter
  const k = (period - 1) / period;
  for (let i = period; i < n; i++) {
    atr[i] = atr[i - 1]! * k + tr[i] / period;
  }

  return atr;
}

/** Round a share quantity down to the nearest board-lot (A-share = 100 shares). */
const LOT = 100;
function toLots(raw: number): number {
  return Math.floor(raw / LOT) * LOT;
}

/* ═════════════════════════════════════════════════════════════════
   MAIN BACKTEST FUNCTION
   ═════════════════════════════════════════════════════════════════ */

export function runBacktest(data: OHLCV[], params: BacktestParams): BacktestResult {
  // ── helpers for the empty-result shape ──────────────────────
  const emptyStats = (): BacktestResult['stats'] => ({
    totalReturn: 0,
    annualizedReturn: 0,
    benchmarkReturn: 0,
    excessReturn: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxDrawdownDuration: 0,
    sharpeRatio: 0,
    avgHoldingDays: 0,
    bestTrade: 0,
    worstTrade: 0,
    totalCommission: 0,
    finalCapital: params.initialCapital,
  });

  if (data.length < 2) {
    return { trades: [], equityCurve: [], stats: emptyStats(), signals: [] };
  }

  // ── ATR series ──────────────────────────────────────────────
  const atrSeries = calculateATR(data, params.atrPeriod);

  // ── Date → row-index map (for holding-days calculation) ─────
  const dateIdx = new Map<string, number>();
  for (let i = 0; i < data.length; i++) dateIdx.set(data[i].date, i);

  // ── Strategy mutable state ──────────────────────────────────
  let cash   = params.initialCapital;
  let shares = 0;
  let nextId = 0;

  const trades:  Trade[]    = [];
  const signals: BacktestResult['signals'] = [];
  const equityCurve: BacktestResult['equityCurve'] = [];

  let inPos       = false;
  let N0          = 0;    // ATR frozen at first entry (used for add levels)
  let entryPrice0 = 0;    // close of the initial entry bar
  let peakPrice   = 0;    // highest price seen since entry
  let unitCount   = 0;    // how many units currently held (1 … maxUnits)
  let costBasis   = 0;    // Σ(shares × price) across all buys in current trip
  let buyComm     = 0;    // Σ commissions  across all buys in current trip

  // ── Benchmark: buy-and-hold from the very first bar ────────
  const bmQty  = toLots(params.initialCapital / data[0].close);
  const bmCost = bmQty * data[0].close;
  const bmCash = params.initialCapital - bmCost - bmCost * params.commissionRate;

  // ═══════════════════════════════════════════════════════════
  //  DAY-BY-DAY LOOP
  // ═══════════════════════════════════════════════════════════
  for (let i = 0; i < data.length; i++) {
    const bar = data[i];
    const curATR = atrSeries[i];

    // If ATR is unavailable or degenerate, skip signal logic
    if (curATR === null || curATR <= 0 || bar.close <= 0) {
      equityCurve.push({
        date: bar.date,
        equity: cash + shares * bar.close,
        benchmarkEquity: bmCash + bmQty * bar.close,
      });
      continue;
    }

    // ──────────── IN POSITION ─────────────────────────────────
    if (inPos) {
      // Track the highest price reached since entry
      if (bar.high > peakPrice) peakPrice = bar.high;

      // ① Check EXIT conditions ──────────────────────────────
      let doExit      = false;
      let exitPrice   = 0;
      let exitReason  = '';

      // a) Stop-loss: intraday low ≤ peak − multiplier × N
      const stopLevel = peakPrice - params.stopLossMultiplier * curATR;
      if (bar.low <= stopLevel) {
        doExit     = true;
        exitPrice  = stopLevel;                       // assume fill at stop
        exitReason = `${params.stopLossMultiplier}N止损离场`;
      }

      // b) Time exit: close < lowest close of past exitPeriod bars
      if (!doExit && i >= params.exitPeriod) {
        let loClose = Infinity;
        for (let j = i - params.exitPeriod; j < i; j++) {
          if (data[j].close < loClose) loClose = data[j].close;
        }
        if (bar.close < loClose) {
          doExit     = true;
          exitPrice  = bar.close;
          exitReason = `跌破${params.exitPeriod}日最低离场`;
        }
      }

      if (doExit) {
        // ── SELL everything ─────────────────────────────────
        const revenue = shares * exitPrice;
        const comm    = revenue * (params.commissionRate + params.stampDutyRate);
        cash += revenue - comm;

        trades.push({
          id:         nextId++,
          type:       'sell',
          date:       bar.date,
          price:      exitPrice,
          shares,
          unitIndex:  -1,
          commission: comm,
          reason:     exitReason,
        });
        signals.push({ date: bar.date, type: 'sell', price: exitPrice, reason: exitReason });

        // reset position state
        shares     = 0;
        inPos      = false;
        unitCount  = 0;
        costBasis  = 0;
        buyComm    = 0;
      } else {
        // ② Check ADDING positions ───────────────────────────
        if (unitCount < params.maxUnits) {
          // Next add level = entryPrice0 + unitCount × 0.5 × N0
          const addThreshold =
            entryPrice0 + unitCount * params.addIntervalMultiplier * N0;

          if (bar.close >= addThreshold) {
            // Turtle sizing: dollars-at-risk / N = shares per unit
            const qty  = toLots(
              (params.initialCapital * params.riskPerTrade) / curATR,
            );

            if (qty >= LOT) {
              const cost = qty * bar.close;
              const comm = cost * params.commissionRate;
              if (cost + comm <= cash) {
                cash      -= cost + comm;
                shares    += qty;
                costBasis += cost;
                buyComm   += comm;
                unitCount += 1;

                const reason =
                  `加仓第${unitCount}个单位 (突破${addThreshold.toFixed(2)})`;

                trades.push({
                  id:         nextId++,
                  type:       'buy',
                  date:       bar.date,
                  price:      bar.close,
                  shares:     qty,
                  unitIndex:  unitCount - 1,
                  commission: comm,
                  reason,
                });
                signals.push({
                  date: bar.date, type: 'buy', price: bar.close, reason,
                });
              }
            }
          }
        }
      }
    }

    // ──────────── NOT IN POSITION – check ENTRY ───────────────
    if (!inPos && i >= params.breakoutPeriod) {
      let hiClose = -Infinity;
      for (let j = i - params.breakoutPeriod; j < i; j++) {
        if (data[j].close > hiClose) hiClose = data[j].close;
      }

      if (bar.close > hiClose) {
        N0          = curATR;
        entryPrice0 = bar.close;

        // Turtle sizing: dollars-at-risk / N = shares per unit
        const qty  = toLots(
          (params.initialCapital * params.riskPerTrade) / curATR,
        );

        if (qty >= LOT) {
          const cost = qty * bar.close;
          const comm = cost * params.commissionRate;

          if (cost + comm <= cash) {
            cash       -= cost + comm;
            shares      = qty;
            peakPrice   = bar.close;
            costBasis   = cost;
            buyComm     = comm;
            unitCount   = 1;
            inPos       = true;

            const reason = `突破${params.breakoutPeriod}日高点入场`;

            trades.push({
              id:         nextId++,
              type:       'buy',
              date:       bar.date,
              price:      bar.close,
              shares:     qty,
              unitIndex:  0,
              commission: comm,
              reason,
            });
            signals.push({
              date: bar.date, type: 'buy', price: bar.close, reason,
            });
          }
        }
      }
    }

    // ── Record daily equity ───────────────────────────────────
    equityCurve.push({
      date:            bar.date,
      equity:          cash + shares * bar.close,
      benchmarkEquity: bmCash + bmQty * bar.close,
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  STATISTICS
  // ═══════════════════════════════════════════════════════════

  // ── 1. Group trades into round-trips ───────────────────────
  const roundTrips: RoundTrip[] = [];
  let rtCost    = 0;
  let rtComm    = 0;
  let rtEntDate = '';
  let rtEntIdx  = 0;

  for (const t of trades) {
    if (t.type === 'buy') {
      if (rtCost === 0) {                       // first buy of a new trip
        rtEntDate = t.date;
        rtEntIdx  = dateIdx.get(t.date) ?? 0;
      }
      rtCost += t.price * t.shares;
      rtComm += t.commission;
    } else {
      // sell → close the current round-trip
      const revenue  = t.price * t.shares;
      const sellComm = t.commission;
      const profit   = revenue - rtCost - rtComm - sellComm;
      const exitIdx  = dateIdx.get(t.date) ?? 0;

      roundTrips.push({
        entryDate:  rtEntDate,
        exitDate:   t.date,
        profit,
        returnPct:  rtCost > 0 ? (profit / rtCost) * 100 : 0,
        holdingDays: Math.max(0, exitIdx - rtEntIdx),
      });

      rtCost = 0;
      rtComm = 0;
    }
  }

  // ── 2. Return / drawdown from equity curve ─────────────────
  const lastEq = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].equity
    : params.initialCapital;

  const lastBm = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].benchmarkEquity
    : params.initialCapital;

  const totalReturn     = ((lastEq - params.initialCapital) / params.initialCapital) * 100;
  const benchmarkReturn = ((lastBm - params.initialCapital) / params.initialCapital) * 100;

  const tradingDays = data.length;
  const annualizedReturn = (tradingDays > 0 && lastEq > 0)
    ? (Math.pow(lastEq / params.initialCapital, 252 / tradingDays) - 1) * 100
    : 0;

  let maxDD    = 0;
  let maxDDLen = 0;
  let ddLen    = 0;
  let ddPeak   = params.initialCapital;

  for (const pt of equityCurve) {
    if (pt.equity > ddPeak) {
      ddPeak = pt.equity;
      ddLen  = 0;
    } else {
      ddLen++;
      if (ddLen > maxDDLen) maxDDLen = ddLen;
    }
    const dd = ddPeak > 0 ? ((ddPeak - pt.equity) / ddPeak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // ── 3. Win / loss metrics ──────────────────────────────────
  const wins   = roundTrips.filter(r => r.profit > 0);
  const losses = roundTrips.filter(r => r.profit <= 0);
  const wCount = wins.length;
  const lCount = losses.length;
  const total  = roundTrips.length;

  const winRate = total > 0 ? (wCount / total) * 100 : 0;

  const avgWin  = wCount > 0 ? wins.reduce((s, r) => s + r.returnPct, 0) / wCount  : 0;
  const avgLoss = lCount > 0 ? losses.reduce((s, r) => s + r.returnPct, 0) / lCount : 0;

  const grossWin  = wins.reduce((s, r) => s + r.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.profit, 0));
  const profitFactor = grossLoss > 0
    ? grossWin / grossLoss
    : grossWin > 0 ? Infinity : 0;

  // ── 4. Sharpe ratio (approximate) ──────────────────────────
  const dailyRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) dailyRets.push(equityCurve[i].equity / prev - 1);
  }

  let sharpe = 0;
  if (dailyRets.length > 1) {
    const mu = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
    const variance =
      dailyRets.reduce((a, r) => a + (r - mu) ** 2, 0) / (dailyRets.length - 1);
    const sigma = Math.sqrt(variance);
    sharpe = sigma > 0 ? (mu / sigma) * Math.sqrt(252) : 0;
  }

  // ── 5. Remaining stats ─────────────────────────────────────
  const avgHold     = total > 0
    ? roundTrips.reduce((s, r) => s + r.holdingDays, 0) / total : 0;
  const bestTrade   = total > 0 ? Math.max(...roundTrips.map(r => r.returnPct)) : 0;
  const worstTrade  = total > 0 ? Math.min(...roundTrips.map(r => r.returnPct)) : 0;
  const totalComm   = trades.reduce((s, t) => s + t.commission, 0);

  return {
    trades,
    equityCurve,
    signals,
    stats: {
      totalReturn,
      annualizedReturn,
      benchmarkReturn,
      excessReturn:        totalReturn - benchmarkReturn,
      totalTrades:         total,
      winningTrades:       wCount,
      losingTrades:        lCount,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown:         maxDD,
      maxDrawdownDuration: maxDDLen,
      sharpeRatio:         sharpe,
      avgHoldingDays:      avgHold,
      bestTrade,
      worstTrade,
      totalCommission:     totalComm,
      finalCapital:        lastEq,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/signal – Current trading signal analysis
// ─────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchLatestData, type OHLCV } from "@/lib/market-data";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const signalSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  system: z.union([z.literal(1), z.literal(2)], {
    message: "system must be 1 or 2",
  }),
  breakoutPeriod: z.number().int().positive("breakoutPeriod must be a positive integer"),
  exitPeriod: z.number().int().positive("exitPeriod must be a positive integer"),
  atrPeriod: z.number().int().positive("atrPeriod must be a positive integer"),
});

type SignalRequest = z.infer<typeof signalSchema>;

// ---------------------------------------------------------------------------
// ATR calculation (Wilder's smoothing – matches turtle-engine internals)
// ---------------------------------------------------------------------------

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
      Math.abs(data[i].low - data[i - 1].close),
    );
  }

  if (n < period) return atr;

  // Seed = SMA of first `period` TRs
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body: unknown = await request.json();
    const parsed = signalSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues?.[0];
      const message = firstError
        ? `${firstError.path.join(".")}: ${firstError.message}`
        : "Invalid request body";
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 },
      );
    }

    const params: SignalRequest = parsed.data;

    // 2. Fetch ~120 calendar days of data (extra for indicator warmup)
    const allData = await fetchLatestData(params.symbol, 120);

    if (allData.length < 2) {
      return NextResponse.json(
        { success: false, error: `Insufficient data for "${params.symbol}". Need at least 2 trading days.` },
        { status: 400 },
      );
    }

    // 3. Calculate ATR (N value)
    const atrSeries = calculateATR(allData, params.atrPeriod);

    const lastIdx = allData.length - 1;
    const currentBar = allData[lastIdx];
    const currentPrice = currentBar.close;
    const currentN = atrSeries[lastIdx] ?? 0;

    // 4. Breakout level = highest close of the past `breakoutPeriod` days (excluding today)
    const breakoutLookback = Math.max(0, lastIdx - params.breakoutPeriod);
    let breakoutLevel = -Infinity;
    for (let i = breakoutLookback; i < lastIdx; i++) {
      if (allData[i].close > breakoutLevel) {
        breakoutLevel = allData[i].close;
      }
    }
    if (!isFinite(breakoutLevel)) {
      breakoutLevel = currentPrice;
    }

    // 5. Exit level = lowest close of the past `exitPeriod` days (excluding today)
    const exitLookback = Math.max(0, lastIdx - params.exitPeriod);
    let exitLevel = Infinity;
    for (let i = exitLookback; i < lastIdx; i++) {
      if (allData[i].close < exitLevel) {
        exitLevel = allData[i].close;
      }
    }
    if (!isFinite(exitLevel)) {
      exitLevel = currentPrice;
    }

    // 6. Percentage distances
    const distanceToBreakout =
      currentPrice > 0
        ? ((breakoutLevel - currentPrice) / currentPrice) * 100
        : 0;
    const distanceToExit =
      currentPrice > 0
        ? ((currentPrice - exitLevel) / currentPrice) * 100
        : 0;

    // 7. Determine signal
    let signal: "bullish" | "bearish" | "neutral";

    if (currentPrice > breakoutLevel) {
      // Already above breakout – bullish (breakout has occurred)
      signal = "bullish";
    } else if (distanceToBreakout <= 2) {
      // Within 2% of breakout – bullish alert
      signal = "bullish";
    } else if (currentPrice < exitLevel) {
      // Already below exit – bearish (exit triggered)
      signal = "bearish";
    } else if (distanceToExit <= 2) {
      // Within 2% of exit – bearish alert
      signal = "bearish";
    } else {
      signal = "neutral";
    }

    // 8. Recent 60 days for display
    const recentData = allData.slice(-60);

    // 9. Generate human-readable analysis
    const analysis = buildAnalysis({
      symbol: params.symbol,
      system: params.system,
      currentPrice,
      currentN,
      signal,
      breakoutLevel,
      exitLevel,
      distanceToBreakout,
      distanceToExit,
      breakoutPeriod: params.breakoutPeriod,
      exitPeriod: params.exitPeriod,
    });

    // 10. Return result
    return NextResponse.json({
      success: true,
      data: {
        symbol: params.symbol,
        currentPrice,
        currentN,
        signal,
        breakoutLevel,
        exitLevel,
        distanceToBreakout,
        distanceToExit,
        recentData,
        analysis,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Analysis text builder
// ---------------------------------------------------------------------------

interface AnalysisParams {
  symbol: string;
  system: 1 | 2;
  currentPrice: number;
  currentN: number;
  signal: "bullish" | "bearish" | "neutral";
  breakoutLevel: number;
  exitLevel: number;
  distanceToBreakout: number;
  distanceToExit: number;
  breakoutPeriod: number;
  exitPeriod: number;
}

function buildAnalysis(p: AnalysisParams): string {
  const price = p.currentPrice.toFixed(2);
  const bo = p.breakoutLevel.toFixed(2);
  const ex = p.exitLevel.toFixed(2);
  const n = p.currentN.toFixed(2);
  const dBo = p.distanceToBreakout.toFixed(2);
  const dEx = p.distanceToExit.toFixed(2);

  switch (p.signal) {
    case "bullish":
      if (p.currentPrice > p.breakoutLevel) {
        return (
          `${p.symbol} 当前价格 ${price} 已突破 ${p.breakoutPeriod} 日高点 ${bo}，` +
          `当前超出 ${Math.abs(p.distanceToBreakout).toFixed(2)}%。` +
          `ATR(N) = ${n}，按海龟交易法系统${p.system}，突破已确认，处于多头信号区域。` +
          `止损参考位: ${(p.breakoutLevel - 2 * p.currentN).toFixed(2)}（高点 − 2N）。`
        );
      }
      return (
        `${p.symbol} 当前价格 ${price} 距 ${p.breakoutPeriod} 日突破高点 ${bo} 仅 ${dBo}%，` +
        `处于突破临界区域。ATR(N) = ${n}，按海龟交易法系统${p.system}，` +
        `若有效突破 ${bo}，可考虑入场做多。` +
        `止损参考位: ${(p.breakoutLevel - 2 * p.currentN).toFixed(2)}（高点 − 2N）。`
      );

    case "bearish":
      if (p.currentPrice < p.exitLevel) {
        return (
          `${p.symbol} 当前价格 ${price} 已跌破 ${p.exitPeriod} 日低点 ${ex}，` +
          `当前超出 ${Math.abs(p.distanceToExit).toFixed(2)}%。` +
          `ATR(N) = ${n}，按海龟交易法系统${p.system}，` +
          `退出信号已触发，应考虑止损离场。`
        );
      }
      return (
        `${p.symbol} 当前价格 ${price} 距 ${p.exitPeriod} 日低点 ${ex} 仅 ${dEx}%，` +
        `存在破位下跌风险。ATR(N) = ${n}，按海龟交易法系统${p.system}，` +
        `若跌破 ${ex}，应考虑止损离场。`
      );

    case "neutral":
      return (
        `${p.symbol} 当前价格 ${price}，` +
        `距${p.breakoutPeriod}日突破高点 ${bo} 还有 ${dBo}%，` +
        `距${p.exitPeriod}日低点 ${ex} 还有 ${dEx}%，处于震荡区间。` +
        `ATR(N) = ${n}，建议继续观望，等待突破信号。`
      );
  }
}

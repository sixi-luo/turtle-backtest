// ─────────────────────────────────────────────────────────────────
// POST /api/backtest – Run a turtle-trading backtest
// ─────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchHistoricalData } from "@/lib/market-data";
import { runBacktest, type BacktestParams, type BacktestResult } from "@/lib/turtle-engine";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const backtestSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  initialCapital: z.number().positive("initialCapital must be > 0"),
  commissionRate: z.number().min(0, "commissionRate must be >= 0"),
  stampDutyRate: z.number().min(0, "stampDutyRate must be >= 0"),
  system: z.union([z.literal(1), z.literal(2)], {
    message: "system must be 1 or 2",
  }),
  breakoutPeriod: z.number().int().positive("breakoutPeriod must be a positive integer"),
  exitPeriod: z.number().int().positive("exitPeriod must be a positive integer"),
  atrPeriod: z.number().int().positive("atrPeriod must be a positive integer"),
  stopLossMultiplier: z.number().positive("stopLossMultiplier must be > 0"),
  addIntervalMultiplier: z.number().positive("addIntervalMultiplier must be > 0"),
  maxUnits: z.number().int().positive("maxUnits must be a positive integer"),
  riskPerTrade: z
    .number()
    .min(0, "riskPerTrade must be >= 0")
    .max(1, "riskPerTrade must be <= 1"),
});

type BacktestRequest = z.infer<typeof backtestSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Subtract `n` calendar days from a YYYY-MM-DD string. */
function subtractDays(dateStr: string, n: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - n);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body: unknown = await request.json();
    const parsed = backtestSchema.safeParse(body);

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

    const params: BacktestRequest = parsed.data;

    // 2. Validate date ordering
    if (params.startDate > params.endDate) {
      return NextResponse.json(
        { success: false, error: "startDate must be on or before endDate" },
        { status: 400 },
      );
    }

    // 3. Add buffer days before startDate so that indicators can warm up
    //    We use 90 calendar days (~65 trading days) which comfortably covers
    //    the max breakoutPeriod of 55 and atrPeriod of 20.
    const BUFFER_DAYS = 90;
    const bufferedStart = subtractDays(params.startDate, BUFFER_DAYS);

    // 4. Fetch historical data (including buffer period)
    const allData = await fetchHistoricalData(
      params.symbol,
      bufferedStart,
      params.endDate,
    );

    if (allData.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `No data available for "${params.symbol}" in the requested period.`,
        },
        { status: 404 },
      );
    }

    // 5. Build BacktestParams and run the engine
    const backtestParams: BacktestParams = {
      symbol: params.symbol,
      initialCapital: params.initialCapital,
      commissionRate: params.commissionRate,
      stampDutyRate: params.stampDutyRate,
      system: params.system,
      breakoutPeriod: params.breakoutPeriod,
      exitPeriod: params.exitPeriod,
      atrPeriod: params.atrPeriod,
      stopLossMultiplier: params.stopLossMultiplier,
      addIntervalMultiplier: params.addIntervalMultiplier,
      maxUnits: params.maxUnits,
      riskPerTrade: params.riskPerTrade,
    };

    const fullResult: BacktestResult = runBacktest(allData, backtestParams);

    // 6. Filter output to the user-requested date range only
    //    (buffer days are only for warmup; we don't want them in results)
    const result: BacktestResult = {
      trades: fullResult.trades.filter((t) => t.date >= params.startDate),
      signals: fullResult.signals.filter((s) => s.date >= params.startDate),
      equityCurve: fullResult.equityCurve.filter(
        (pt) => pt.date >= params.startDate,
      ),
      stats: fullResult.stats,
    };

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

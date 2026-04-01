// ---------------------------------------------------------------------------
// market-data.ts – TickFlow 金融数据 API 接口
// 数据源：https://api.tickflow.org
// 覆盖：A股、美股、港股 日K线数据
// ---------------------------------------------------------------------------

export interface OHLCV {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockInfo {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TICKFLOW_BASE_URL = "https://api.tickflow.org";
const TICKFLOW_API_KEY = "tk_30ae030be65b43ee895ad79b00b75acd";
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Symbol format helpers
// ---------------------------------------------------------------------------

/**
 * 将常见代码格式自动转换为 TickFlow 标准格式：
 *   A股：600519    → 600519.SH    （默认上海）
 *         000001    → 000001.SZ    （深圳 0/3 开头）
 *         300001    → 300001.SZ    （创业板 3 开头）
 *         688001    → 688001.SH    （科创板 688 开头）
 *   美股：AAPL      → AAPL.US
 *         MSFT      → MSFT.US
 *   港股：00700     → 00700.HK     （5位数字）
 *   已带后缀的直接透传
 */
export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();

  // Already has TickFlow suffix
  if (s.endsWith(".SH") || s.endsWith(".SZ") || s.endsWith(".US") || s.endsWith(".HK")) {
    return s;
  }

  // Pure numeric → A-share
  if (/^\d+$/.test(s)) {
    if (s.startsWith("688")) return `${s}.SH`;    // 科创板
    if (s.startsWith("6"))   return `${s}.SH`;     // 上海
    if (s.startsWith("0") || s.startsWith("3")) return `${s}.SZ`; // 深圳/创业板
    if (s.startsWith("4") || s.startsWith("8")) return `${s}.BJ`; // 北交所
    return `${s}.SH`; // default to Shanghai
  }

  // 5-digit starting with 0 → HK stock
  if (/^0\d{4}$/.test(s)) return `${s}.HK`;

  // Everything else → US stock
  return `${s}.US`;
}

/**
 * 检测市场类型
 */
export type Market = "A-SH" | "A-SZ" | "A-BJ" | "US" | "HK" | "UNKNOWN";

export function detectMarket(symbol: string): Market {
  const s = symbol.toUpperCase();
  if (s.endsWith(".SH")) return "A-SH";
  if (s.endsWith(".SZ")) return "A-SZ";
  if (s.endsWith(".BJ")) return "A-BJ";
  if (s.endsWith(".US")) return "US";
  if (s.endsWith(".HK")) return "HK";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD → Unix milliseconds timestamp (UTC 00:00:00) */
function dateToMs(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

/** Unix ms → YYYY-MM-DD (UTC) */
function msToDate(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today as YYYY-MM-DD */
function todayUTC(): string {
  return msToDate(Date.now());
}

/** Return YYYY-MM-DD that is `n` calendar days before `referenceDate` */
function subtractDays(referenceDate: string, n: number): string {
  const ts = dateToMs(referenceDate) - n * 86_400_000;
  return msToDate(ts);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// TickFlow API types
// ---------------------------------------------------------------------------

/**
 * TickFlow 返回紧凑列式数据：
 * {
 *   "data": {
 *     "timestamp": [1234567890000, ...],
 *     "open": [100.0, ...],
 *     "high": [102.0, ...],
 *     "low": [99.0, ...],
 *     "close": [101.0, ...],
 *     "volume": [1000000, ...],
 *     "amount": [100000000.0, ...]
 *   }
 * }
 */
interface TickFlowKlineData {
  data: {
    timestamp: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    amount?: number[];
  };
}

interface TickFlowApiError {
  code: string;
  message: string;
  details?: string;
}

interface TickFlowInstrumentsResponse {
  data: Array<{
    symbol: string;
    name: string;
    exchange: string;
    type: string;
    currency: string;
    lot_size?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Core: fetch K-lines from TickFlow
// ---------------------------------------------------------------------------

async function fetchTickFlowKlines(
  symbol: string,
  startTimeMs: number,
  endTimeMs: number,
  period: string = "1d",
  adjust: string = "none",
): Promise<TickFlowKlineData> {
  const params = new URLSearchParams({
    symbol,
    period,
    start_time: String(startTimeMs),
    end_time: String(endTimeMs),
    adjust,
  });

  const url = `${TICKFLOW_BASE_URL}/v1/klines?${params.toString()}`;

  const res = await fetchWithTimeout(url, {
    headers: {
      "x-api-key": TICKFLOW_API_KEY,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    let errorMsg = `TickFlow API returned HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as TickFlowApiError;
      errorMsg = errBody.message || errBody.code || errorMsg;
    } catch {
      // ignore parse error
    }
    throw new Error(errorMsg);
  }

  const data = (await res.json()) as TickFlowKlineData | TickFlowApiError;

  // Check if response is an error
  if ("code" in data && "message" in data) {
    throw new Error(`TickFlow: ${(data as TickFlowApiError).message} (${(data as TickFlowApiError).code})`);
  }

  const klineData = data as TickFlowKlineData;
  const d = klineData.data;

  if (!d || !d.timestamp || d.timestamp.length === 0) {
    throw new Error(
      `No K-line data returned for "${symbol}". ` +
      `Please check the symbol format (e.g. AAPL.US, 600519.SH, 00700.HK).`,
    );
  }

  return klineData;
}

// ---------------------------------------------------------------------------
// Parse TickFlow columnar data → OHLCV[]
// ---------------------------------------------------------------------------

function parseTickFlowKlines(klineData: TickFlowKlineData): OHLCV[] {
  const d = klineData.data;
  const count = d.timestamp.length;
  const ohlcv: OHLCV[] = [];

  for (let i = 0; i < count; i++) {
    const close = d.close[i];
    if (close == null || close <= 0) continue;

    ohlcv.push({
      date: msToDate(d.timestamp[i]),
      open: d.open[i] ?? close,
      high: d.high[i] ?? close,
      low: d.low[i] ?? close,
      close,
      volume: d.volume[i] ?? 0,
    });
  }

  // Sort ascending by date
  ohlcv.sort((a, b) => a.date.localeCompare(b.date));
  return ohlcv;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 获取历史日K线数据
 *
 * @param symbol   标的代码（支持自动格式转换，如 AAPL / 600519 / 00700）
 * @param startDate "YYYY-MM-DD" 含
 * @param endDate   "YYYY-MM-DD" 含
 * @returns 按日期升序排列的 OHLCV 数组
 */
export async function fetchHistoricalData(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<OHLCV[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`Invalid startDate format: "${startDate}". Expected YYYY-MM-DD.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Invalid endDate format: "${endDate}". Expected YYYY-MM-DD.`);
  }
  if (startDate > endDate) {
    throw new Error("startDate must be on or before endDate.");
  }

  const normalized = normalizeSymbol(symbol);
  const startTimeMs = dateToMs(startDate);
  // Include the full end day (23:59:59.999)
  const endTimeMs = dateToMs(endDate) + 86_399_999;

  const klineData = await fetchTickFlowKlines(
    normalized,
    startTimeMs,
    endTimeMs,
    "1d",
    "none",
  );

  const ohlcv = parseTickFlowKlines(klineData);

  // Trim to exact date range (API may return slightly more)
  const filtered = ohlcv.filter(
    (bar) => bar.date >= startDate && bar.date <= endDate,
  );

  if (filtered.length === 0) {
    throw new Error(
      `No data available for "${normalized}" between ${startDate} and ${endDate}.`,
    );
  }

  return filtered;
}

/**
 * 获取最近 N 天的日K线数据
 *
 * @param symbol 标的代码
 * @param days   回溯天数（日历天，默认 120）
 * @returns 按日期升序排列的 OHLCV 数组
 */
export async function fetchLatestData(
  symbol: string,
  days: number = 120,
): Promise<OHLCV[]> {
  if (days <= 0) {
    throw new Error("days must be a positive integer.");
  }

  const endDate = todayUTC();
  const startDate = subtractDays(endDate, days);

  return fetchHistoricalData(symbol, startDate, endDate);
}

/**
 * 查询标的信息（名称、交易所等）
 *
 * @param symbols 标的代码数组（已自动格式化）
 * @returns 标的信息数组
 */
export async function fetchInstruments(
  symbols: string[],
): Promise<StockInfo[]> {
  if (!symbols || symbols.length === 0) {
    throw new Error("At least one symbol is required.");
  }

  const normalized = symbols.map(normalizeSymbol);
  const symbolsParam = normalized.join(",");

  const url = `${TICKFLOW_BASE_URL}/v1/instruments?symbols=${encodeURIComponent(symbolsParam)}`;

  const res = await fetchWithTimeout(url, {
    headers: {
      "x-api-key": TICKFLOW_API_KEY,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    let errorMsg = `TickFlow API returned HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as TickFlowApiError;
      errorMsg = errBody.message || errBody.code || errorMsg;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  const data = (await res.json()) as TickFlowInstrumentsResponse;

  return (data.data ?? []).map((item) => ({
    symbol: item.symbol,
    name: item.name ?? "",
    exchange: item.exchange ?? "",
    type: item.type ?? "",
    currency: item.currency ?? "",
  }));
}

/**
 * 根据标的代码查询信息（单个）
 */
export async function fetchInstrument(symbol: string): Promise<StockInfo> {
  const results = await fetchInstruments([symbol]);
  if (results.length === 0) {
    throw new Error(`Instrument not found: "${normalizeSymbol(symbol)}"`);
  }
  return results[0];
}

/**
 * 搜索股票（兼容旧接口）
 * TickFlow 不支持模糊搜索，此函数直接查询标的信息
 */
export async function searchStock(query: string): Promise<StockInfo[]> {
  if (!query || query.trim().length === 0) {
    throw new Error("Search query must not be empty.");
  }

  try {
    const info = await fetchInstrument(query.trim());
    return [info];
  } catch {
    return [];
  }
}

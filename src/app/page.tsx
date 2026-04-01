'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Toaster } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Turtle,
  TrendingUp,
  Search,
  Play,
  BarChart3,
  Activity,
  AlertTriangle,
  Info,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Loader2,
  LineChart,
  Target,
  Shield,
  Zap,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  ReferenceLine,
  Cell,
} from 'recharts';
import { format, parseISO } from 'date-fns';

// ─── UI Components ─────────────────────────────────────────────
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ─── Types ─────────────────────────────────────────────────────

interface BacktestStats {
  totalReturn: number;
  annualizedReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  sharpeRatio: number;
  avgHoldingDays: number;
  bestTrade: number;
  worstTrade: number;
  totalCommission: number;
  finalCapital: number;
}

interface BacktestTrade {
  id: number;
  type: 'buy' | 'sell';
  date: string;
  price: number;
  shares: number;
  unitIndex: number;
  commission: number;
  reason: string;
}

interface EquityPoint {
  date: string;
  equity: number;
  benchmarkEquity: number;
}

interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  stats: BacktestStats;
}

interface SignalResult {
  symbol: string;
  currentPrice: number;
  currentN: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  breakoutLevel: number;
  exitLevel: number;
  distanceToBreakout: number;
  distanceToExit: number;
  recentData: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  analysis: string;
}

// ─── Parameter descriptions (for tooltips) ────────────────────

const PARAM_DESCRIPTIONS: Record<string, string> = {
  symbol: 'A股: 600519/600519.SH(沪)、000001/000001.SZ(深)；美股: AAPL/AAPL.US；港股: 00700/00700.HK',
  system: '系统1（短期）：20日突破/10日离场；系统2（长期）：55日突破/20日离场',
  initialCapital: '回测账户初始资金，单位：元',
  commissionRate: '每笔交易的佣金费率，例如 0.001 表示 0.1%',
  stampDutyRate: '卖出时的印花税率，A股为 0.1%，美股通常为 0',
  breakoutPeriod: '价格突破N日最高价时入场，系统1默认20日，系统2默认55日',
  exitPeriod: '价格跌破N日最低价时离场，系统1默认10日，系统2默认20日',
  atrPeriod: 'ATR（真实波动幅度）计算周期，用于衡量市场波动性',
  stopLossMultiplier: '止损距离 = 最高价 − 倍数 × N，默认2N止损',
  addIntervalMultiplier: '加仓间隔 = 初始入场价 + 单位数 × 倍数 × N，默认0.5N',
  maxUnits: '同一标的最大持仓单位数量，分散风险',
  riskPerTrade: '每笔交易风险占总资金比例，默认1%',
  startDate: '回测开始日期',
  endDate: '回测结束日期',
};

// ─── Helper Components ─────────────────────────────────────────

/** Info icon with tooltip */
function ParamHint({ paramKey }: { paramKey: string }) {
  const desc = PARAM_DESCRIPTIONS[paramKey];
  if (!desc) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="inline-block size-3.5 text-slate-400 cursor-help ml-1" />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-slate-200 bg-slate-700 border-slate-600">
        <p className="text-xs">{desc}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Animated card wrapper */
function AnimatedCard({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

/** Loading skeleton for results */
function ResultsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Performance cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="bg-slate-800/50 backdrop-blur border-slate-700">
            <CardContent className="pt-4 pb-4">
              <Skeleton className="h-4 w-20 mb-2 bg-slate-700" />
              <Skeleton className="h-8 w-28 bg-slate-700" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Stats table skeleton */}
      <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
        <CardHeader>
          <Skeleton className="h-6 w-32 bg-slate-700" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full bg-slate-700" />
        </CardContent>
      </Card>
      {/* Chart skeleton */}
      <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
        <CardHeader>
          <Skeleton className="h-6 w-40 bg-slate-700" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full bg-slate-700" />
        </CardContent>
      </Card>
    </div>
  );
}

/** Signal loading skeleton */
function SignalSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="bg-slate-800/50 backdrop-blur border-slate-700">
            <CardContent className="pt-4 pb-4">
              <Skeleton className="h-4 w-24 mb-2 bg-slate-700" />
              <Skeleton className="h-8 w-32 bg-slate-700" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
        <CardContent className="pt-4 pb-4">
          <Skeleton className="h-24 w-full bg-slate-700" />
        </CardContent>
      </Card>
      <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
        <CardHeader>
          <Skeleton className="h-6 w-32 bg-slate-700" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full bg-slate-700" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Custom Recharts Tooltips ──────────────────────────────────

function EquityTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs">
      <p className="text-slate-300 mb-2 font-medium">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="text-slate-100 font-mono">
            {typeof entry.value === 'number' ? entry.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function SignalChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs">
      <p className="text-slate-300 mb-2 font-medium">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-400">{entry.name}:</span>
          <span className="text-slate-100 font-mono">
            {typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PAGE COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function Home() {
  // ─── State: Backtest params ──────────────────────────────────
  const [btSymbol, setBtSymbol] = useState('AAPL.US');
  const [btSystem, setBtSystem] = useState<'1' | '2'>('1');
  const [btInitialCapital, setBtInitialCapital] = useState('100000');
  const [btCommission, setBtCommission] = useState('0.001');
  const [btStampDuty, setBtStampDuty] = useState('0.001');
  const [btBreakout, setBtBreakout] = useState('20');
  const [btExit, setBtExit] = useState('10');
  const [btAtr, setBtAtr] = useState('20');
  const [btStopLoss, setBtStopLoss] = useState('2');
  const [btAddInterval, setBtAddInterval] = useState('0.5');
  const [btMaxUnits, setBtMaxUnits] = useState('4');
  const [btRiskPerTrade, setBtRiskPerTrade] = useState('0.01');
  const [btStartDate, setBtStartDate] = useState('2024-01-01');
  const [btEndDate, setBtEndDate] = useState('2025-12-31');

  // ─── State: Signal params ────────────────────────────────────
  const [sigSymbol, setSigSymbol] = useState('AAPL.US');
  const [sigSystem, setSigSystem] = useState<'1' | '2'>('1');
  const [sigBreakout, setSigBreakout] = useState('20');
  const [sigExit, setSigExit] = useState('10');
  const [sigAtr, setSigAtr] = useState('20');

  // ─── State: Results ──────────────────────────────────────────
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [signalLoading, setSignalLoading] = useState(false);

  // ─── Auto-fill breakout/exit when system changes ─────────────
  const handleBtSystemChange = useCallback((val: string) => {
    setBtSystem(val as '1' | '2');
    if (val === '1') {
      setBtBreakout('20');
      setBtExit('10');
    } else {
      setBtBreakout('55');
      setBtExit('20');
    }
  }, []);

  const handleSigSystemChange = useCallback((val: string) => {
    setSigSystem(val as '1' | '2');
    if (val === '1') {
      setSigBreakout('20');
      setSigExit('10');
    } else {
      setSigBreakout('55');
      setSigExit('20');
    }
  }, []);

  // ─── Run Backtest ────────────────────────────────────────────
  const handleBacktest = useCallback(async () => {
    if (!btSymbol.trim()) {
      toast.error('请输入股票代码');
      return;
    }
    setBacktestLoading(true);
    setBacktestResult(null);

    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: btSymbol.trim(),
          startDate: btStartDate,
          endDate: btEndDate,
          initialCapital: parseFloat(btInitialCapital),
          commissionRate: parseFloat(btCommission),
          stampDutyRate: parseFloat(btStampDuty),
          system: parseInt(btSystem) as 1 | 2,
          breakoutPeriod: parseInt(btBreakout),
          exitPeriod: parseInt(btExit),
          atrPeriod: parseInt(btAtr),
          stopLossMultiplier: parseFloat(btStopLoss),
          addIntervalMultiplier: parseFloat(btAddInterval),
          maxUnits: parseInt(btMaxUnits),
          riskPerTrade: parseFloat(btRiskPerTrade),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        toast.error(data.error || '回测失败，请检查参数');
        return;
      }

      setBacktestResult(data.data);
      toast.success('回测完成！');
    } catch (err) {
      toast.error('网络错误，请稍后重试');
      console.error(err);
    } finally {
      setBacktestLoading(false);
    }
  }, [
    btSymbol, btStartDate, btEndDate, btInitialCapital,
    btCommission, btStampDuty, btSystem, btBreakout, btExit,
    btAtr, btStopLoss, btAddInterval, btMaxUnits, btRiskPerTrade,
  ]);

  // ─── Get Signal ──────────────────────────────────────────────
  const handleSignal = useCallback(async () => {
    if (!sigSymbol.trim()) {
      toast.error('请输入股票代码');
      return;
    }
    setSignalLoading(true);
    setSignalResult(null);

    try {
      const response = await fetch('/api/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sigSymbol.trim(),
          system: parseInt(sigSystem) as 1 | 2,
          breakoutPeriod: parseInt(sigBreakout),
          exitPeriod: parseInt(sigExit),
          atrPeriod: parseInt(sigAtr),
        }),
      });

      const data = await response.json();

      if (!data.success) {
        toast.error(data.error || '获取信号失败');
        return;
      }

      setSignalResult(data.data);
      toast.success('信号获取成功！');
    } catch (err) {
      toast.error('网络错误，请稍后重试');
      console.error(err);
    } finally {
      setSignalLoading(false);
    }
  }, [sigSymbol, sigSystem, sigBreakout, sigExit, sigAtr]);

  // ─── Format helpers ──────────────────────────────────────────
  const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const fmtMoney = (v: number) => '¥' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // ─── Compute round-trip P&L from trades ──────────────────────
  const computeRoundTrips = (trades: BacktestTrade[]) => {
    const trips: { buyDate: string; sellDate: string; pnl: number; pnlPct: number }[] = [];
    let buyInfo: { date: string; totalCost: number; shares: number } | null = null;

    for (const t of trades) {
      if (t.type === 'buy') {
        if (!buyInfo) {
          buyInfo = { date: t.date, totalCost: 0, shares: 0 };
        }
        buyInfo.totalCost += t.price * t.shares;
        buyInfo.shares += t.shares;
      } else if (t.type === 'sell' && buyInfo) {
        const revenue = t.price * t.shares;
        const totalComm = buyInfo.totalCost > 0
          ? trades.filter(x => x.date >= buyInfo!.date && x.date <= t.date).reduce((s, x) => s + x.commission, 0)
          : 0;
        const pnl = revenue - buyInfo.totalCost - totalComm;
        const pnlPct = buyInfo.totalCost > 0 ? (pnl / buyInfo.totalCost) * 100 : 0;
        trips.push({ buyDate: buyInfo.date, sellDate: t.date, pnl, pnlPct });
        buyInfo = null;
      }
    }
    return trips;
  };

  // ─── Equity chart data with return % ─────────────────────────
  const equityChartData = backtestResult
    ? (() => {
        const init = parseFloat(btInitialCapital);
        return backtestResult.equityCurve.map((pt) => ({
          date: pt.date,
          策略净值: pt.equity,
          基准净值: pt.benchmarkEquity,
          策略收益率: ((pt.equity - init) / init) * 100,
          基准收益率: ((pt.benchmarkEquity - init) / init) * 100,
        }));
      })()
    : [];

  // ─── Signal chart data ───────────────────────────────────────
  const signalChartData = signalResult
    ? signalResult.recentData.map((d) => ({
        date: d.date,
        收盘价: d.close,
        最高价: d.high,
        最低价: d.low,
        振幅: [d.open, d.close],
        成交量: d.volume,
      }))
    : [];

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <Toaster theme="dark" position="top-right" richColors />

      {/* ═══════════════════ HEADER ═══════════════════ */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-600/20 border border-emerald-500/30">
              <Turtle className="size-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">
                海龟突破法则回测平台
              </h1>
              <p className="text-xs text-slate-400 tracking-wide">
                Turtle Trading Breakout Strategy Backtester
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <Activity className="size-3.5" />
            <span>量化回测系统</span>
          </div>
        </div>
      </header>

      {/* ═══════════════════ MAIN CONTENT ═══════════════════ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs defaultValue="backtest" className="w-full">
          <TabsList className="bg-slate-800/80 border border-slate-700 mb-6">
            <TabsTrigger value="backtest" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white gap-1.5 px-4">
              <BarChart3 className="size-4" />
              <span>历史回测</span>
            </TabsTrigger>
            <TabsTrigger value="signal" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white gap-1.5 px-4">
              <Target className="size-4" />
              <span>交易指导</span>
            </TabsTrigger>
          </TabsList>

          {/* ────────────────────────────────────────────
              TAB 1: 历史回测
          ──────────────────────────────────────────── */}
          <TabsContent value="backtest">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* ─── LEFT: Parameter Panel ─── */}
              <div className="lg:col-span-4 xl:col-span-3">
                <Card className="bg-slate-800/50 backdrop-blur border-slate-700 sticky top-24">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base font-semibold text-slate-200 flex items-center gap-2">
                      <Zap className="size-4 text-emerald-400" />
                      回测参数配置
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400">
                      配置海龟交易法参数，运行历史回测
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 股票代码 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-300 flex items-center">
                        股票代码
                        <ParamHint paramKey="symbol" />
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          value={btSymbol}
                          onChange={(e) => setBtSymbol(e.target.value)}
                          placeholder="AAPL.US / 600519 / 00700.HK"
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50 focus-visible:border-emerald-500"
                        />
                      </div>
                    </div>

                    {/* 回测系统 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-300 flex items-center">
                        回测系统
                        <ParamHint paramKey="system" />
                      </Label>
                      <Select value={btSystem} onValueChange={handleBtSystemChange}>
                        <SelectTrigger className="w-full bg-slate-900/60 border-slate-600 text-sm h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          <SelectItem value="1">系统1（短期 20日突破）</SelectItem>
                          <SelectItem value="2">系统2（长期 55日突破）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* 初始资金 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-300 flex items-center">
                        初始资金
                        <ParamHint paramKey="initialCapital" />
                      </Label>
                      <Input
                        type="number"
                        value={btInitialCapital}
                        onChange={(e) => setBtInitialCapital(e.target.value)}
                        className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                      />
                    </div>

                    {/* 佣金 + 印花税 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          佣金费率
                          <ParamHint paramKey="commissionRate" />
                        </Label>
                        <Input
                          type="number"
                          step="0.0001"
                          value={btCommission}
                          onChange={(e) => setBtCommission(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          印花税率
                          <ParamHint paramKey="stampDutyRate" />
                        </Label>
                        <Input
                          type="number"
                          step="0.0001"
                          value={btStampDuty}
                          onChange={(e) => setBtStampDuty(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* 突破周期 + 离场周期 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          突破周期
                          <ParamHint paramKey="breakoutPeriod" />
                        </Label>
                        <Input
                          type="number"
                          value={btBreakout}
                          onChange={(e) => setBtBreakout(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          离场周期
                          <ParamHint paramKey="exitPeriod" />
                        </Label>
                        <Input
                          type="number"
                          value={btExit}
                          onChange={(e) => setBtExit(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                    </div>

                    {/* ATR周期 */}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-300 flex items-center">
                        ATR周期
                        <ParamHint paramKey="atrPeriod" />
                      </Label>
                      <Input
                        type="number"
                        value={btAtr}
                        onChange={(e) => setBtAtr(e.target.value)}
                        className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                      />
                    </div>

                    {/* 止损倍数 + 加仓间隔 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          止损倍数
                          <ParamHint paramKey="stopLossMultiplier" />
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={btStopLoss}
                          onChange={(e) => setBtStopLoss(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          加仓间隔
                          <ParamHint paramKey="addIntervalMultiplier" />
                        </Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={btAddInterval}
                          onChange={(e) => setBtAddInterval(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                    </div>

                    {/* 最大头寸 + 风险比例 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          最大头寸单位
                          <ParamHint paramKey="maxUnits" />
                        </Label>
                        <Input
                          type="number"
                          value={btMaxUnits}
                          onChange={(e) => setBtMaxUnits(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300 flex items-center">
                          单笔风险比例
                          <ParamHint paramKey="riskPerTrade" />
                        </Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={btRiskPerTrade}
                          onChange={(e) => setBtRiskPerTrade(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* 日期范围 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300">开始日期</Label>
                        <Input
                          type="date"
                          value={btStartDate}
                          onChange={(e) => setBtStartDate(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300">结束日期</Label>
                        <Input
                          type="date"
                          value={btEndDate}
                          onChange={(e) => setBtEndDate(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-8 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                    </div>

                    {/* Submit Button */}
                    <Button
                      onClick={handleBacktest}
                      disabled={backtestLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-10 text-sm font-medium mt-2"
                    >
                      {backtestLoading ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          回测中...
                        </>
                      ) : (
                        <>
                          <Play className="size-4 mr-2" />
                          开始回测
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* ─── RIGHT: Results Panel ─── */}
              <div className="lg:col-span-8 xl:col-span-9">
                <AnimatePresence mode="wait">
                  {backtestLoading ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <ResultsSkeleton />
                    </motion.div>
                  ) : backtestResult ? (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-6"
                    >
                      {/* ─── Performance Summary Cards ─── */}
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                        <AnimatedCard index={0}>
                          <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                            <CardContent className="pt-3 pb-3 px-4">
                              <p className="text-xs text-slate-400 mb-1">总收益率</p>
                              <p className={`text-xl font-bold font-mono ${backtestResult.stats.totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {fmtPct(backtestResult.stats.totalReturn)}
                              </p>
                            </CardContent>
                          </Card>
                        </AnimatedCard>

                        <AnimatedCard index={1}>
                          <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                            <CardContent className="pt-3 pb-3 px-4">
                              <p className="text-xs text-slate-400 mb-1">年化收益率</p>
                              <p className={`text-xl font-bold font-mono ${backtestResult.stats.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {fmtPct(backtestResult.stats.annualizedReturn)}
                              </p>
                            </CardContent>
                          </Card>
                        </AnimatedCard>

                        <AnimatedCard index={2}>
                          <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                            <CardContent className="pt-3 pb-3 px-4">
                              <p className="text-xs text-slate-400 mb-1">超额收益</p>
                              <p className={`text-xl font-bold font-mono ${backtestResult.stats.excessReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {fmtPct(backtestResult.stats.excessReturn)}
                              </p>
                            </CardContent>
                          </Card>
                        </AnimatedCard>

                        <AnimatedCard index={3}>
                          <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                            <CardContent className="pt-3 pb-3 px-4">
                              <p className="text-xs text-slate-400 mb-1">最大回撤</p>
                              <p className="text-xl font-bold font-mono text-rose-400">
                                -{backtestResult.stats.maxDrawdown.toFixed(2)}%
                              </p>
                            </CardContent>
                          </Card>
                        </AnimatedCard>

                        <AnimatedCard index={4}>
                          <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                            <CardContent className="pt-3 pb-3 px-4">
                              <p className="text-xs text-slate-400 mb-1">夏普比率</p>
                              <p className={`text-xl font-bold font-mono ${backtestResult.stats.sharpeRatio >= 1 ? 'text-emerald-400' : backtestResult.stats.sharpeRatio >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                                {backtestResult.stats.sharpeRatio.toFixed(2)}
                              </p>
                            </CardContent>
                          </Card>
                        </AnimatedCard>

                        <AnimatedCard index={5}>
                          <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                            <CardContent className="pt-3 pb-3 px-4">
                              <p className="text-xs text-slate-400 mb-1">胜率</p>
                              <p className={`text-xl font-bold font-mono ${backtestResult.stats.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {backtestResult.stats.winRate.toFixed(1)}%
                              </p>
                            </CardContent>
                          </Card>
                        </AnimatedCard>
                      </div>

                      {/* ─── Trading Statistics Table ─── */}
                      <AnimatedCard index={6}>
                        <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                              <LineChart className="size-4 text-emerald-400" />
                              交易统计
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <Table>
                              <TableBody>
                                {[
                                  ['总交易次数', backtestResult.stats.totalTrades, ''],
                                  ['盈利次数', backtestResult.stats.winningTrades, 'text-emerald-400'],
                                  ['亏损次数', backtestResult.stats.losingTrades, 'text-rose-400'],
                                  ['平均盈利', fmtPct(backtestResult.stats.avgWin), 'text-emerald-400'],
                                  ['平均亏损', fmtPct(backtestResult.stats.avgLoss), 'text-rose-400'],
                                  ['盈亏比', backtestResult.stats.profitFactor === Infinity ? '∞' : backtestResult.stats.profitFactor.toFixed(2), ''],
                                  ['最佳交易', fmtPct(backtestResult.stats.bestTrade), 'text-emerald-400'],
                                  ['最差交易', fmtPct(backtestResult.stats.worstTrade), 'text-rose-400'],
                                  ['平均持仓天数', backtestResult.stats.avgHoldingDays.toFixed(1), ''],
                                  ['总手续费', fmtMoney(backtestResult.stats.totalCommission), 'text-slate-300'],
                                ].map(([label, value, color], i) => (
                                  <TableRow key={i} className="border-slate-700/50">
                                    <TableCell className="text-slate-400 text-xs py-2">{label as string}</TableCell>
                                    <TableCell className={`text-xs font-mono font-medium text-right py-2 ${color}`}>
                                      {value as React.ReactNode}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </CardContent>
                        </Card>
                      </AnimatedCard>

                      {/* ─── Equity Curve Chart ─── */}
                      <AnimatedCard index={7}>
                        <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                              <TrendingUp className="size-4 text-emerald-400" />
                              资金曲线
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="h-72 sm:h-80">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={equityChartData} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
                                  <defs>
                                    <linearGradient id="strategyGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                                    </linearGradient>
                                    <linearGradient id="benchmarkGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#64748b" stopOpacity={0.15} />
                                      <stop offset="95%" stopColor="#64748b" stopOpacity={0.02} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                                  <XAxis
                                    dataKey="date"
                                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                                    axisLine={{ stroke: '#334155' }}
                                    tickLine={false}
                                    tickFormatter={(v: string) => {
                                      try {
                                        return format(parseISO(v), 'MM/dd');
                                      } catch {
                                        return v;
                                      }
                                    }}
                                  />
                                  <YAxis
                                    yAxisId="value"
                                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                                    axisLine={{ stroke: '#334155' }}
                                    tickLine={false}
                                    tickFormatter={(v: number) => {
                                      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
                                      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'K';
                                      return v.toFixed(0);
                                    }}
                                  />
                                  <YAxis
                                    yAxisId="pct"
                                    orientation="right"
                                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                                    axisLine={{ stroke: '#334155' }}
                                    tickLine={false}
                                    tickFormatter={(v: number) => v.toFixed(0) + '%'}
                                  />
                                  <RechartsTooltip content={<EquityTooltipContent />} />
                                  <Legend
                                    wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                                    iconType="line"
                                    iconSize={12}
                                  />
                                  <Area
                                    yAxisId="value"
                                    type="monotone"
                                    dataKey="策略净值"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    fill="url(#strategyGradient)"
                                  />
                                  <Area
                                    yAxisId="value"
                                    type="monotone"
                                    dataKey="基准净值"
                                    stroke="#64748b"
                                    strokeWidth={1.5}
                                    strokeDasharray="5 5"
                                    fill="url(#benchmarkGradient)"
                                  />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </CardContent>
                        </Card>
                      </AnimatedCard>

                      {/* ─── Trade History Table ─── */}
                      <AnimatedCard index={8}>
                        <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                              <Activity className="size-4 text-emerald-400" />
                              交易记录
                              <Badge variant="outline" className="text-xs ml-1 border-slate-600 text-slate-400">
                                {backtestResult.trades.length} 笔
                              </Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ScrollArea className="max-h-96">
                              <Table>
                                <TableHeader>
                                  <TableRow className="border-slate-700 hover:bg-transparent">
                                    <TableHead className="text-slate-400 text-xs">序号</TableHead>
                                    <TableHead className="text-slate-400 text-xs">类型</TableHead>
                                    <TableHead className="text-slate-400 text-xs">日期</TableHead>
                                    <TableHead className="text-slate-400 text-xs text-right">价格</TableHead>
                                    <TableHead className="text-slate-400 text-xs text-right">股数</TableHead>
                                    <TableHead className="text-slate-400 text-xs text-right">手续费</TableHead>
                                    <TableHead className="text-slate-400 text-xs">原因</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {backtestResult.trades.map((trade, idx) => {
                                    const isBuy = trade.type === 'buy';
                                    return (
                                      <TableRow key={trade.id} className="border-slate-700/50">
                                        <TableCell className="text-xs text-slate-400 py-2">{idx + 1}</TableCell>
                                        <TableCell className="py-2">
                                          <Badge
                                            variant="outline"
                                            className={`text-xs ${isBuy ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-rose-500/50 text-rose-400 bg-rose-500/10'}`}
                                          >
                                            {isBuy ? '买入' : '卖出'}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-300 font-mono py-2">{trade.date}</TableCell>
                                        <TableCell className="text-xs text-slate-200 font-mono text-right py-2">{trade.price.toFixed(2)}</TableCell>
                                        <TableCell className="text-xs text-slate-300 font-mono text-right py-2">{trade.shares.toLocaleString()}</TableCell>
                                        <TableCell className="text-xs text-slate-400 font-mono text-right py-2">{trade.commission.toFixed(2)}</TableCell>
                                        <TableCell className="text-xs text-slate-400 py-2">{trade.reason}</TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </ScrollArea>
                          </CardContent>
                        </Card>
                      </AnimatedCard>

                      {/* ─── Round-trip P&L Summary (if applicable) ─── */}
                      {backtestResult.trades.length > 0 && (() => {
                        const trips = computeRoundTrips(backtestResult.trades);
                        if (trips.length === 0) return null;
                        return (
                          <AnimatedCard index={9}>
                            <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                                  <TrendingUp className="size-4 text-emerald-400" />
                                  完整交易盈亏
                                  <Badge variant="outline" className="text-xs ml-1 border-slate-600 text-slate-400">
                                    {trips.length} 轮
                                  </Badge>
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <ScrollArea className="max-h-64">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="border-slate-700 hover:bg-transparent">
                                        <TableHead className="text-slate-400 text-xs">买入日期</TableHead>
                                        <TableHead className="text-slate-400 text-xs">卖出日期</TableHead>
                                        <TableHead className="text-slate-400 text-xs text-right">盈亏</TableHead>
                                        <TableHead className="text-slate-400 text-xs text-right">收益率</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {trips.map((trip, idx) => (
                                        <TableRow key={idx} className="border-slate-700/50">
                                          <TableCell className="text-xs text-slate-300 font-mono py-2">{trip.buyDate}</TableCell>
                                          <TableCell className="text-xs text-slate-300 font-mono py-2">{trip.sellDate}</TableCell>
                                          <TableCell className={`text-xs font-mono text-right py-2 ${trip.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {trip.pnl >= 0 ? '+' : ''}{fmtMoney(trip.pnl)}
                                          </TableCell>
                                          <TableCell className={`text-xs font-mono text-right py-2 ${trip.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {fmtPct(trip.pnlPct)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </ScrollArea>
                              </CardContent>
                            </Card>
                          </AnimatedCard>
                        );
                      })()}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <Card className="bg-slate-800/30 backdrop-blur border-slate-700/50 border-dashed">
                        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                          <div className="p-4 rounded-2xl bg-slate-800/80 mb-4">
                            <BarChart3 className="size-12 text-slate-600" />
                          </div>
                          <h3 className="text-sm font-medium text-slate-400 mb-1">等待回测</h3>
                          <p className="text-xs text-slate-500 max-w-xs">
                            在左侧配置好参数后，点击"开始回测"按钮运行海龟突破策略回测
                          </p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </TabsContent>

          {/* ────────────────────────────────────────────
              TAB 2: 交易指导
          ──────────────────────────────────────────── */}
          <TabsContent value="signal">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* ─── Signal Input Panel ─── */}
              <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base font-semibold text-slate-200 flex items-center gap-2">
                    <Target className="size-4 text-emerald-400" />
                    实时交易信号
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    基于海龟交易法分析当前市场状态，获取交易信号
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-300">股票代码</Label>
                      <Input
                        value={sigSymbol}
                        onChange={(e) => setSigSymbol(e.target.value)}
                        placeholder="AAPL.US / 600519 / 00700.HK"
                        className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-9 focus-visible:ring-emerald-500/50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-300 flex items-center">
                        回测系统
                        <ParamHint paramKey="system" />
                      </Label>
                      <Select value={sigSystem} onValueChange={handleSigSystemChange}>
                        <SelectTrigger className="w-full bg-slate-900/60 border-slate-600 text-sm h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-600">
                          <SelectItem value="1">系统1（短期）</SelectItem>
                          <SelectItem value="2">系统2（长期）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300">突破周期</Label>
                        <Input
                          type="number"
                          value={sigBreakout}
                          onChange={(e) => setSigBreakout(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-9 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-slate-300">离场周期</Label>
                        <Input
                          type="number"
                          value={sigExit}
                          onChange={(e) => setSigExit(e.target.value)}
                          className="bg-slate-900/60 border-slate-600 text-slate-100 text-sm h-9 focus-visible:ring-emerald-500/50"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={handleSignal}
                      disabled={signalLoading}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-sm font-medium"
                    >
                      {signalLoading ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          分析中...
                        </>
                      ) : (
                        <>
                          <Search className="size-4 mr-2" />
                          获取信号
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* ─── Signal Result Display ─── */}
              <AnimatePresence mode="wait">
                {signalLoading ? (
                  <motion.div
                    key="sig-loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <SignalSkeleton />
                  </motion.div>
                ) : signalResult ? (
                  <motion.div
                    key="sig-results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {/* Signal Status + Key Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Current Price & N */}
                      <AnimatedCard index={0}>
                        <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                          <CardContent className="pt-4 pb-4">
                            <p className="text-xs text-slate-400 mb-1">当前价格</p>
                            <p className="text-2xl font-bold font-mono text-slate-100">
                              ${signalResult.currentPrice.toFixed(2)}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              ATR (N值): <span className="text-slate-300 font-mono">{signalResult.currentN.toFixed(2)}</span>
                            </p>
                          </CardContent>
                        </Card>
                      </AnimatedCard>

                      {/* Breakout Level */}
                      <AnimatedCard index={1}>
                        <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                          <CardContent className="pt-4 pb-4">
                            <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                              <ArrowUpRight className="size-3 text-emerald-400" />
                              突破水平
                            </p>
                            <p className="text-2xl font-bold font-mono text-emerald-400">
                              ${signalResult.breakoutLevel.toFixed(2)}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              距突破: <span className={`font-mono ${signalResult.distanceToBreakout > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {signalResult.distanceToBreakout > 0 ? '+' : ''}{signalResult.distanceToBreakout.toFixed(2)}%
                              </span>
                            </p>
                          </CardContent>
                        </Card>
                      </AnimatedCard>

                      {/* Exit Level */}
                      <AnimatedCard index={2}>
                        <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                          <CardContent className="pt-4 pb-4">
                            <p className="text-xs text-slate-400 mb-1 flex items-center gap-1">
                              <ArrowDownRight className="size-3 text-rose-400" />
                              离场水平
                            </p>
                            <p className="text-2xl font-bold font-mono text-rose-400">
                              ${signalResult.exitLevel.toFixed(2)}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              距离场: <span className={`font-mono ${signalResult.distanceToExit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {signalResult.distanceToExit.toFixed(2)}%
                              </span>
                            </p>
                          </CardContent>
                        </Card>
                      </AnimatedCard>
                    </div>

                    {/* Signal Badge + Analysis */}
                    <AnimatedCard index={3}>
                      <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                        <CardContent className="pt-5 pb-5">
                          <div className="flex items-center gap-3 mb-4">
                            <p className="text-sm text-slate-300">当前信号：</p>
                            {signalResult.signal === 'bullish' && (
                              <Badge className="bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-600/30 text-sm px-3 py-1 gap-1.5">
                                <TrendingUp className="size-3.5" />
                                看多
                              </Badge>
                            )}
                            {signalResult.signal === 'bearish' && (
                              <Badge className="bg-rose-600/20 text-rose-400 border border-rose-500/40 hover:bg-rose-600/30 text-sm px-3 py-1 gap-1.5">
                                <AlertTriangle className="size-3.5" />
                                看空
                              </Badge>
                            )}
                            {signalResult.signal === 'neutral' && (
                              <Badge className="bg-amber-600/20 text-amber-400 border border-amber-500/40 hover:bg-amber-600/30 text-sm px-3 py-1 gap-1.5">
                                <Eye className="size-3.5" />
                                观望
                              </Badge>
                            )}
                          </div>
                          <Separator className="bg-slate-700 mb-4" />
                          <p className="text-sm text-slate-300 leading-relaxed">
                            {signalResult.analysis}
                          </p>
                        </CardContent>
                      </Card>
                    </AnimatedCard>

                    {/* Mini Chart */}
                    <AnimatedCard index={4}>
                      <Card className="bg-slate-800/50 backdrop-blur border-slate-700">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                            <LineChart className="size-4 text-emerald-400" />
                            近60日价格走势
                            <Badge variant="outline" className="text-xs ml-1 border-slate-600 text-slate-400">
                              {signalResult.symbol}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="h-64 sm:h-72">
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={signalChartData} margin={{ top: 10, right: 5, left: 10, bottom: 5 }}>
                                <defs>
                                  <linearGradient id="sigPriceGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
                                <XAxis
                                  dataKey="date"
                                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                                  axisLine={{ stroke: '#334155' }}
                                  tickLine={false}
                                  tickFormatter={(v: string) => {
                                    try {
                                      return format(parseISO(v), 'MM/dd');
                                    } catch {
                                      return v;
                                    }
                                  }}
                                />
                                <YAxis
                                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                                  axisLine={{ stroke: '#334155' }}
                                  tickLine={false}
                                  domain={['auto', 'auto']}
                                  tickFormatter={(v: number) => v.toFixed(1)}
                                />
                                <RechartsTooltip content={<SignalChartTooltipContent />} />
                                <Legend
                                  wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                                  iconType="line"
                                  iconSize={12}
                                />
                                {/* Bar for high-low range */}
                                <Bar
                                  dataKey="振幅"
                                  fill="#475569"
                                  opacity={0.3}
                                  isAnimationActive={false}
                                />
                                {/* Close price line */}
                                <Line
                                  type="monotone"
                                  dataKey="收盘价"
                                  stroke="#10b981"
                                  strokeWidth={2}
                                  dot={false}
                                />
                                {/* Breakout reference line */}
                                <ReferenceLine
                                  y={signalResult.breakoutLevel}
                                  stroke="#f59e0b"
                                  strokeDasharray="6 3"
                                  strokeWidth={1.5}
                                  label={{
                                    value: `突破: ${signalResult.breakoutLevel.toFixed(2)}`,
                                    position: 'insideTopRight',
                                    fill: '#f59e0b',
                                    fontSize: 10,
                                  }}
                                />
                                {/* Exit reference line */}
                                <ReferenceLine
                                  y={signalResult.exitLevel}
                                  stroke="#ef4444"
                                  strokeDasharray="6 3"
                                  strokeWidth={1.5}
                                  label={{
                                    value: `离场: ${signalResult.exitLevel.toFixed(2)}`,
                                    position: 'insideBottomRight',
                                    fill: '#ef4444',
                                    fontSize: 10,
                                  }}
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                    </AnimatedCard>
                  </motion.div>
                ) : (
                  <motion.div
                    key="sig-empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Card className="bg-slate-800/30 backdrop-blur border-slate-700/50 border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="p-4 rounded-2xl bg-slate-800/80 mb-4">
                          <Target className="size-12 text-slate-600" />
                        </div>
                        <h3 className="text-sm font-medium text-slate-400 mb-1">等待信号分析</h3>
                        <p className="text-xs text-slate-500 max-w-xs">
                          输入股票代码并选择交易系统，点击"获取信号"查看海龟交易法分析结果
                        </p>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* ═══════════════════ FOOTER ═══════════════════ */}
      <footer className="border-t border-slate-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Shield className="size-3.5" />
              <span>海龟交易法回测系统 — 仅供研究参考，不构成投资建议</span>
            </div>
            <div className="text-xs text-slate-600">
              Turtle Trading Breakout Strategy Backtester
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

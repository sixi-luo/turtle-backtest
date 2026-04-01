# 🐢 海龟突破法则回测平台

> Turtle Trading Breakout Strategy Backtester — 基于 Next.js 的全栈量化回测系统

## ✨ 功能特性

- **完整回测引擎**：实现了海龟交易法则全部核心逻辑（突破入场、ATR仓位管理、金字塔加仓、双重止损）
- **双系统支持**：系统1（20日突破/10日离场）和系统2（55日突破/20日离场）
- **全市场覆盖**：A股、美股、港股（数据源：[TickFlow API](https://tickflow.org)）
- **实时交易指导**：基于最新数据的看多/看空/观望信号分析
- **丰富的绩效指标**：收益率、年化收益、超额收益、夏普比率、最大回撤、胜率、盈亏比等 16 项统计
- **可视化图表**：策略 vs 基准资金曲线对比图、交易信号价格图

## 🚀 快速开始

### 环境要求

- Node.js 18+ 或 Bun 1.0+
- TickFlow API Key（[免费注册](https://tickflow.org/auth/register/)）

### 安装与运行

```bash
# 1. 安装依赖
bun install

# 2. 配置 API Key
# 编辑 src/lib/market-data.ts 中的 TICKFLOW_API_KEY

# 3. 启动开发服务器
bun run dev

# 4. 浏览器访问 http://localhost:3000
```

### 生产构建

```bash
bun run build
bun run start
```

## 📁 项目结构

```
src/
├── app/
│   ├── page.tsx                 # 前端主页面（回测参数 + 结果展示 + 交易指导）
│   ├── layout.tsx               # 全局布局
│   └── api/
│       ├── backtest/route.ts    # POST /api/backtest — 回测接口
│       └── signal/route.ts      # POST /api/signal — 交易信号接口
├── lib/
│   ├── turtle-engine.ts         # 海龟法则回测引擎（纯算法，无外部依赖）
│   └── market-data.ts           # TickFlow 数据接口 + 代码格式自动转换
└── components/ui/               # shadcn/ui 组件库
```

## 📊 支持的股票代码格式

| 市场 | 格式 | 自动转换示例 |
|------|------|-------------|
| 美股 | 代码.US | `AAPL` → `AAPL.US` |
| A股-沪 | 代码.SH | `600519` → `600519.SH` |
| A股-深 | 代码.SZ | `000001` → `000001.SZ` |
| 港股 | 代码.HK | `00700` → `00700.HK` |

## ⚙️ 策略参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 突破周期 | 20 | 价格突破 N 日最高价入场 |
| 离场周期 | 10 | 价格跌破 N 日最低价离场 |
| ATR周期 | 20 | 真实波幅均值计算周期 |
| 止损倍数 | 2 | 止损 = 最高价 - 2×ATR |
| 加仓间隔 | 0.5 | 每 0.5×ATR 加一个单位 |
| 最大头寸 | 4 | 最多持有 4 个单位 |
| 单笔风险 | 1% | 每单位风险占总资金比例 |

## 🛠 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript 5
- **样式**: Tailwind CSS 4 + shadcn/ui
- **图表**: Recharts
- **动画**: Framer Motion
- **数据**: [TickFlow API](https://tickflow.org)
- **运行时**: Bun

## 📄 License

MIT

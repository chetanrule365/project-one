import { readFileSync } from "node:fs";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../app/lib/dhan/instruments";
import { runBacktest } from "../app/lib/lab/backtest";
import { PROJECT_ONE_ID } from "../app/lib/strategies/project-one";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  /* process.env already set */
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i] ?? "";
  if (!token.startsWith("--")) continue;
  const [key, inline] = token.slice(2).split("=");
  args.set(key, inline ?? process.argv[++i] ?? "");
}

const instrumentId = (args.get("instrument") ?? "NIFTY").toUpperCase();
const strategyId = args.get("strategy") ?? PROJECT_ONE_ID;
const months = Number(args.get("months") ?? 6);
const widthSteps = Number(args.get("width") ?? 2);
const instrument = getIndexByParam(instrumentId) ?? INDEX_INSTRUMENTS[0];

const result = await runBacktest({
  instrument,
  strategyIds: [strategyId],
  widthSteps,
  months,
});

const { metrics, trades } = result;
console.log(
  JSON.stringify(
    {
      instrument: result.instrumentId,
      strategy: result.strategyIds,
      from: result.from,
      to: result.to,
      lotSize: result.lotSize,
      metrics: {
        trades: metrics.trades,
        wins: metrics.wins,
        losses: metrics.losses,
        winRate: Number(metrics.winRate.toFixed(1)),
        totalPnlPoints: Number(metrics.totalPnlPoints.toFixed(1)),
        totalPnlInr: Math.round(metrics.totalPnlInr),
        brokerageInr: Math.round(metrics.brokerageInr),
        totalPnlAfterBrokerageInr: Math.round(metrics.totalPnlAfterBrokerageInr),
        avgPnlPoints: Number(metrics.avgPnlPoints.toFixed(1)),
        maxDrawdownInr: Math.round(metrics.maxDrawdownInr),
        profitFactor: Number.isFinite(metrics.profitFactor)
          ? Number(metrics.profitFactor.toFixed(2))
          : metrics.profitFactor,
      },
      exits: Object.fromEntries(
        [...new Set(trades.map((t) => t.exitReason ?? "unknown"))].map((reason) => [
          reason,
          trades.filter((t) => t.exitReason === reason).length,
        ]),
      ),
      trades: trades.map((t) => ({
        day: t.entryDay,
        in: t.entryHour,
        out: t.exitHour,
        side: t.longSide,
        debit: Number(t.credit.toFixed(1)),
        pnlPts: Number(t.pnlPoints.toFixed(1)),
        pnlInr: Math.round(t.pnlInr),
        brokerageInr: Math.round(t.brokerageInr ?? 0),
        pnlAfterBrokerageInr: Math.round(t.pnlAfterBrokerageInr ?? t.pnlInr),
        reason: t.pickReason,
        exit: t.exitReason,
      })),
    },
    null,
    2,
  ),
);

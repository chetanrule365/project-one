import { todayIst } from "../strategies/expiry-day";
import { roundTripBrokerageInr } from "../strategies/cost-filter";
import { inferLegCount, marginRequiredInr } from "./margin";

/**
 * Capital blocked in ₹ for 1 lot.
 * Buys: premium paid. 4-leg IC: Dhan SPAN (~4.4% of notional).
 * 2-leg credits: defined-risk max loss (width − credit).
 */
export function marginConsumedInr(trade: {
  instrument_id?: string;
  strategy_id: string;
  credit: number;
  width: number;
  spot_entry?: number;
  legs?: Array<unknown>;
  legCount?: number;
}) {
  return marginRequiredInr({
    instrumentId: trade.instrument_id,
    strategyId: trade.strategy_id,
    credit: trade.credit,
    width: trade.width,
    spot: trade.spot_entry,
    legCount: trade.legCount ?? trade.legs?.length,
  });
}

/** Dhan round-trip brokerage for a paper trade (₹20/order × legs × entry+exit). */
export function paperTradeBrokerageInr(trade: {
  strategy_id: string;
  brokerage_inr?: number | null;
  legs?: Array<unknown>;
  legCount?: number;
}) {
  if (trade.brokerage_inr != null && Number.isFinite(trade.brokerage_inr)) {
    return trade.brokerage_inr;
  }
  return roundTripBrokerageInr(
    inferLegCount({
      strategyId: trade.strategy_id,
      legCount: trade.legCount ?? trade.legs?.length,
    }),
  );
}

export function paperTradeNetPnlInr(trade: {
  pnl_inr?: number | null;
  strategy_id: string;
  brokerage_inr?: number | null;
  legs?: Array<unknown>;
  legCount?: number;
}) {
  if (trade.pnl_inr == null) return null;
  return trade.pnl_inr - paperTradeBrokerageInr(trade);
}

export function currentMonthIst() {
  return todayIst().slice(0, 7);
}

export function entryMonthIst(entryAt: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(entryAt)) return entryAt.slice(0, 7);
  const date = new Date(entryAt);
  if (!Number.isFinite(date.getTime())) return entryAt.slice(0, 7);
  return date
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    .slice(0, 7);
}

export function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T12:00:00+05:30`);
  if (!Number.isFinite(date.getTime())) return month;
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  });
}

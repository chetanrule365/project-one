import type { OptionChainRow } from "../dhan/option-chain";
import { longPremium, settleLegs, shortPremium } from "../strategies/common";
import type { Leg, OpenPosition, OptionRight } from "../strategies/types";
import { positionDefaults } from "../strategies/registry";
import type { PaperTrade } from "./paper-store";

function asRight(value: string | undefined, fallback: OptionRight): OptionRight {
  return value === "PE" || value === "CE" ? value : fallback;
}

function isLeg(value: unknown): value is Leg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Leg;
  return (
    (leg.right === "CE" || leg.right === "PE") &&
    Number.isFinite(leg.strike) &&
    Number.isFinite(leg.qty) &&
    Number.isFinite(leg.premium)
  );
}

/** Rebuild legs from stored JSON, or from the old 2-field summary. */
export function legsFromTrade(trade: PaperTrade): Leg[] {
  const stored = trade.legs?.filter(isLeg) ?? [];
  if (stored.length > 0) return stored;

  const hasShort = Number(trade.short_strike) > 0;
  const hasLong = Number(trade.long_strike) > 0;
  const debit = trade.credit < 0;
  const premium = Math.abs(trade.credit);

  // ORB ATM and other single longs were saved as short_strike=0 + long put/call.
  if (!hasShort && hasLong) {
    return [
      {
        right: asRight(trade.long_side, "CE"),
        strike: trade.long_strike,
        strikeKey: "ATM",
        qty: 1,
        premium,
      },
    ];
  }

  if (hasShort && !hasLong) {
    return [
      {
        right: asRight(trade.short_side, "CE"),
        strike: trade.short_strike,
        strikeKey: "ATM",
        qty: -1,
        premium,
      },
    ];
  }

  if (
    hasShort &&
    hasLong &&
    trade.short_strike === trade.long_strike &&
    trade.short_side === trade.long_side
  ) {
    return [
      {
        right: asRight(trade.short_side, "CE"),
        strike: trade.short_strike,
        strikeKey: "ATM",
        qty: debit ? 1 : -1,
        premium,
      },
    ];
  }

  return [
    {
      right: asRight(trade.short_side, "CE"),
      strike: trade.short_strike,
      strikeKey: "ATM",
      qty: debit ? 1 : -1,
      premium,
    },
    {
      right: asRight(trade.long_side, "CE"),
      strike: trade.long_strike,
      strikeKey: "ATM",
      qty: debit ? -1 : 1,
      premium: 0,
    },
  ].filter((leg) => leg.strike > 0);
}

export function positionFromTrade(trade: PaperTrade): OpenPosition {
  const legs = legsFromTrade(trade);
  return {
    strategyId: trade.strategy_id,
    legs,
    netCredit: trade.credit,
    width: trade.width,
    entryAt: trade.entry_at,
    expiryAt: trade.expiry_at,
    entryHour: trade.entry_hour ?? undefined,
    ...positionDefaults(
      trade.strategy_id,
      trade.expiry_at === trade.entry_at,
    ),
  };
}

export function formatPaperLegs(trade: PaperTrade) {
  return legsFromTrade(trade)
    .map((leg) => `${leg.qty < 0 ? "S" : "B"} ${leg.strike} ${leg.right}`)
    .join(" · ");
}

export function premiumsFromChain(rows: OptionChainRow[], legs: Leg[]) {
  const premiums: Record<string, number> = {};
  for (const leg of legs) {
    const row = rows.find((item) => item.strike === leg.strike);
    if (!row) continue;
    const side = leg.right === "CE" ? row.ce : row.pe;
    const px = leg.qty < 0 ? shortPremium(side) : longPremium(side);
    if (px == null || px < 0) continue;
    premiums[`${leg.strikeKey}:${leg.right}`] = px;
    premiums[`${leg.strike}:${leg.right}`] = px;
  }
  return premiums;
}

export function settleTradePoints(
  trade: PaperTrade,
  spot: number,
  rows?: OptionChainRow[],
) {
  const position = positionFromTrade(trade);
  const premiums =
    rows && rows.length > 0
      ? premiumsFromChain(rows, position.legs)
      : undefined;
  return settleLegs(position, spot, premiums);
}

/** Spot-sized P&L from the old strike-0 CE reconstruction. */
export function pnlLooksBroken(
  stored: number,
  credit: number,
  spot: number,
  corrected: number,
) {
  if (!Number.isFinite(stored)) return true;
  if (spot > 1000 && Math.abs(stored - spot) < spot * 0.08) return true;
  const risk = Math.abs(credit) || 1;
  if (Math.abs(stored) > risk * 8 + 200 && Math.abs(stored - corrected) > 1) {
    return true;
  }
  return false;
}

export function formatIstTimestamp(value: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${time}`;
}

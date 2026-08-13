import type { OptionChainRow, OptionSide } from "../dhan/option-chain";
import type {
  Leg,
  OpenPosition,
  OptionRight,
  Strategy,
  TradeProposal,
} from "./types";

export function atmIndex(rows: OptionChainRow[], spot: number) {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i += 1) {
    const distance = Math.abs(rows[i].strike - spot);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export function shortPremium(side: OptionSide | null) {
  if (!side) return null;
  if (side.bid > 0) return side.bid;
  return side.lastPrice;
}

export function longPremium(side: OptionSide | null) {
  if (!side) return null;
  if (side.ask > 0) return side.ask;
  return side.lastPrice;
}

export function strikeKey(offset: number) {
  if (offset === 0) return "ATM";
  return offset > 0 ? `ATM+${offset}` : `ATM${offset}`;
}

export function intrinsic(right: OptionRight, strike: number, spot: number) {
  return right === "PE"
    ? Math.max(0, strike - spot)
    : Math.max(0, spot - strike);
}

/** Mark each leg: prefer live premium map, else intrinsic. */
export function markLeg(
  leg: Leg,
  spot: number,
  premiums?: Record<string, number>,
) {
  if (leg.strike <= 0) return 0;
  const keyed = premiums?.[`${leg.strikeKey}:${leg.right}`];
  if (keyed !== undefined && keyed >= 0) return keyed;
  const byStrike = premiums?.[`${leg.strike}:${leg.right}`];
  if (byStrike !== undefined && byStrike >= 0) return byStrike;
  return intrinsic(leg.right, leg.strike, spot);
}

/**
 * P&L from entry net credit and current marks.
 * qty −1 short / +1 long → PnL = netCredit + Σ(qty × mark)
 * (closing a short costs mark; closing a long returns mark)
 */
export function settleLegs(
  position: OpenPosition,
  spot: number,
  premiums?: Record<string, number>,
) {
  let exitValue = 0;
  for (const leg of position.legs) {
    exitValue += leg.qty * markLeg(leg, spot, premiums);
  }
  return position.netCredit + exitValue;
}

export function netCreditFromLegs(legs: Leg[]) {
  // Short receives premium, long pays → −Σ(qty × premium) with qty short negative
  // qty=-1, prem=10 → −(−1)*10 = +10 credit. qty=+1, prem=4 → −1*4 = −4.
  return -legs.reduce((s, leg) => s + leg.qty * leg.premium, 0);
}

export function proposalSummary(legs: Leg[]): Pick<
  TradeProposal,
  | "primaryShortStrike"
  | "primaryLongStrike"
  | "primaryShortSide"
  | "primaryLongSide"
  | "width"
> {
  const shorts = legs.filter((l) => l.qty < 0);
  const longs = legs.filter((l) => l.qty > 0);
  const short = shorts[0];
  const long = longs[0] ?? shorts[1] ?? short;
  const pairWidths = shorts.flatMap((s) =>
    longs
      .filter((l) => l.right === s.right)
      .map((l) => Math.abs(l.strike - s.strike)),
  );
  const width = pairWidths.length > 0 ? Math.max(...pairWidths) : 0;
  return {
    primaryShortStrike: short?.strike ?? 0,
    primaryLongStrike: long?.strike ?? 0,
    primaryShortSide: short?.right ?? long?.right ?? "CE",
    primaryLongSide: long?.right ?? short?.right ?? "CE",
    width,
  };
}

export function buildProposal(input: {
  strategyId: string;
  name: string;
  bias: string;
  description: string;
  legs: Leg[];
  maxProfit: number;
  maxLoss: number;
}): TradeProposal | null {
  if (input.legs.length === 0) return null;
  const netCredit = netCreditFromLegs(input.legs);
  const summary = proposalSummary(input.legs);
  return {
    strategyId: input.strategyId,
    name: input.name,
    bias: input.bias,
    description: input.description,
    legs: input.legs,
    netCredit,
    maxProfit: input.maxProfit,
    maxLoss: input.maxLoss,
    ...summary,
  };
}

export function assertStrategy(strategy: Strategy): Strategy {
  return strategy;
}

export function premiumAt(
  premiums: Record<string, number> | undefined,
  key: string,
  right: OptionRight,
) {
  return premiums?.[`${key}:${right}`];
}

export function strikeAt(
  strikes: Record<string, number> | undefined,
  key: string,
) {
  return strikes?.[key];
}

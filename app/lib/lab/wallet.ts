/** Paper and backtest start with this cash. Margin is locked while a trade is open. */
export const WALLET_START_INR = 100_000;

export type WalletSnapshot = {
  startInr: number;
  /** Closed P&L before brokerage. */
  grossRealizedInr: number;
  /** Closed P&L after brokerage. */
  realizedInr: number;
  unrealizedInr: number;
  lockedInr: number;
  freeInr: number;
  equityInr: number;
  /** Sum of round-trip brokerage on closed trades. */
  brokerageInr: number;
};

export function snapshotWallet(input: {
  startInr?: number;
  realizedInr: number;
  grossRealizedInr?: number;
  unrealizedInr?: number;
  lockedInr: number;
  brokerageInr?: number;
}): WalletSnapshot {
  const startInr = input.startInr ?? WALLET_START_INR;
  const realizedInr = input.realizedInr;
  const brokerageInr = input.brokerageInr ?? 0;
  const grossRealizedInr =
    input.grossRealizedInr ?? realizedInr + brokerageInr;
  const unrealizedInr = input.unrealizedInr ?? 0;
  const lockedInr = Math.max(0, input.lockedInr);
  return {
    startInr,
    grossRealizedInr,
    realizedInr,
    unrealizedInr,
    lockedInr,
    freeInr: startInr + realizedInr - lockedInr,
    equityInr: startInr + realizedInr + unrealizedInr,
    brokerageInr,
  };
}

export function walletFromPaperTrades(
  trades: Array<{
    status: "open" | "closed";
    pnl_inr?: number | null;
    pnl_after_brokerage_inr?: number | null;
    brokerage_inr?: number | null;
    mark_pnl_inr?: number | null;
    margin_inr?: number | null;
  }>,
  startInr = WALLET_START_INR,
): WalletSnapshot {
  let grossRealizedInr = 0;
  let realizedInr = 0;
  let unrealizedInr = 0;
  let lockedInr = 0;
  let brokerageInr = 0;
  for (const trade of trades) {
    if (trade.status === "closed") {
      const brok = trade.brokerage_inr ?? 0;
      const gross = trade.pnl_inr ?? 0;
      brokerageInr += brok;
      grossRealizedInr += gross;
      realizedInr += trade.pnl_after_brokerage_inr ?? gross - brok;
      continue;
    }
    lockedInr += trade.margin_inr ?? 0;
    unrealizedInr += trade.mark_pnl_inr ?? 0;
  }
  return snapshotWallet({
    startInr,
    grossRealizedInr,
    realizedInr,
    unrealizedInr,
    lockedInr,
    brokerageInr,
  });
}

export function canAffordMargin(freeInr: number, marginInr: number) {
  return marginInr <= freeInr + 0.5;
}

/** Sequential cash + margin for a backtest (entries skip when free cash is short). */
export class SimWallet {
  readonly startInr: number;
  skipped = 0;
  peakLockedInr = 0;
  private realizedInr = 0;
  private lockedInr = 0;
  private pending: Array<{ exitAt: number; margin: number; pnl: number }> = [];

  constructor(startInr = WALLET_START_INR) {
    this.startInr = startInr;
  }

  freeInr() {
    return this.startInr + this.realizedInr - this.lockedInr;
  }

  equityInr() {
    return this.startInr + this.realizedInr;
  }

  tryOpen(entryAt: number, margin: number, exitAt: number, pnl: number) {
    this.releaseUntil(entryAt);
    if (!canAffordMargin(this.freeInr(), margin)) {
      this.skipped += 1;
      return false;
    }
    this.lockedInr += margin;
    this.peakLockedInr = Math.max(this.peakLockedInr, this.lockedInr);
    this.pending.push({
      exitAt: Math.max(exitAt, entryAt),
      margin,
      pnl,
    });
    return true;
  }

  settle() {
    this.releaseUntil(Number.POSITIVE_INFINITY);
  }

  private releaseUntil(at: number) {
    if (this.pending.length === 0) return;
    const keep: typeof this.pending = [];
    for (const row of this.pending) {
      if (row.exitAt <= at) {
        this.lockedInr -= row.margin;
        this.realizedInr += row.pnl;
      } else {
        keep.push(row);
      }
    }
    this.pending = keep;
  }
}

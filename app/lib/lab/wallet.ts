/** Paper and backtest start with this cash. Margin is locked while a trade is open. */
export const WALLET_START_INR = 100_000;

export type WalletSnapshot = {
  startInr: number;
  realizedInr: number;
  unrealizedInr: number;
  lockedInr: number;
  freeInr: number;
  equityInr: number;
};

export function snapshotWallet(input: {
  startInr?: number;
  realizedInr: number;
  unrealizedInr?: number;
  lockedInr: number;
}): WalletSnapshot {
  const startInr = input.startInr ?? WALLET_START_INR;
  const realizedInr = input.realizedInr;
  const unrealizedInr = input.unrealizedInr ?? 0;
  const lockedInr = Math.max(0, input.lockedInr);
  return {
    startInr,
    realizedInr,
    unrealizedInr,
    lockedInr,
    freeInr: startInr + realizedInr - lockedInr,
    equityInr: startInr + realizedInr + unrealizedInr,
  };
}

export function walletFromPaperTrades(
  trades: Array<{
    status: "open" | "closed";
    pnl_inr?: number | null;
    mark_pnl_inr?: number | null;
    margin_inr?: number | null;
  }>,
  startInr = WALLET_START_INR,
): WalletSnapshot {
  let realizedInr = 0;
  let unrealizedInr = 0;
  let lockedInr = 0;
  for (const trade of trades) {
    if (trade.status === "closed") {
      realizedInr += trade.pnl_inr ?? 0;
      continue;
    }
    lockedInr += trade.margin_inr ?? 0;
    unrealizedInr += trade.mark_pnl_inr ?? 0;
  }
  return snapshotWallet({ startInr, realizedInr, unrealizedInr, lockedInr });
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

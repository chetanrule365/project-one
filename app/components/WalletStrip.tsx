import type { WalletSnapshot } from "../lib/lab/wallet";

function formatInr(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function equityTone(equity: number, start: number) {
  if (equity > start) return "text-emerald-600 dark:text-emerald-400";
  if (equity < start) return "text-rose-600 dark:text-rose-400";
  return "text-slate-900 dark:text-white";
}

export function WalletStrip({
  wallet,
  compact = false,
}: {
  wallet: WalletSnapshot;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-900/70">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Wallet
        </p>
        <p
          className={`mt-0.5 text-sm font-semibold tabular-nums ${equityTone(wallet.equityInr, wallet.startInr)}`}
        >
          ₹ {formatInr(wallet.equityInr)}
        </p>
        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
          Free ₹ {formatInr(wallet.freeInr)}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Equity
        </p>
        <p
          className={`mt-0.5 text-xl font-semibold tabular-nums ${equityTone(wallet.equityInr, wallet.startInr)}`}
        >
          ₹ {formatInr(wallet.equityInr)}
        </p>
      </div>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Free
        </p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
          ₹ {formatInr(wallet.freeInr)}
        </p>
      </div>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Locked
        </p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
          ₹ {formatInr(wallet.lockedInr)}
        </p>
      </div>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Realized
        </p>
        <p
          className={`mt-0.5 text-xl font-semibold tabular-nums ${equityTone(wallet.startInr + wallet.realizedInr, wallet.startInr)}`}
        >
          {wallet.realizedInr > 0
            ? `+₹ ${formatInr(wallet.realizedInr)}`
            : wallet.realizedInr < 0
              ? `−₹ ${formatInr(Math.abs(wallet.realizedInr))}`
              : `₹ ${formatInr(0)}`}
        </p>
      </div>
    </div>
  );
}

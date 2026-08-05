import { DhanApiError, dhanPost } from "./config";
import type { IndexInstrument } from "./instruments";

export type OptionSide = {
  lastPrice: number;
  oi: number;
  volume: number;
  iv: number;
  bid: number;
  ask: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
};

export type OptionChainRow = {
  strike: number;
  ce: OptionSide | null;
  pe: OptionSide | null;
};

export type OptionChainData = {
  spot: number;
  expiry: string;
  expiries: string[];
  rows: OptionChainRow[];
};

type ApiErrorBody = {
  status?: string;
  errorMessage?: string;
  message?: string;
  remarks?: string | { error_code?: string; error_type?: string };
  data?: unknown;
};

type ExpiryListResponse = ApiErrorBody & {
  data?: string[];
};

type OptionLegRaw = {
  last_price?: number;
  oi?: number;
  volume?: number;
  implied_volatility?: number;
  top_bid_price?: number;
  top_ask_price?: number;
  greeks?: {
    delta?: number;
    theta?: number;
    gamma?: number;
    vega?: number;
  };
};

type OptionChainResponse = ApiErrorBody & {
  data?: {
    last_price?: number;
    oc?: Record<
      string,
      {
        ce?: OptionLegRaw;
        pe?: OptionLegRaw;
      }
    >;
  };
};

function errorMessage(payload: ApiErrorBody, fallback: string) {
  if (typeof payload.remarks === "string" && payload.remarks) {
    return payload.remarks;
  }
  return payload.errorMessage || payload.message || fallback;
}

function mapSide(raw: OptionLegRaw | undefined): OptionSide | null {
  if (!raw) return null;
  return {
    lastPrice: raw.last_price ?? 0,
    oi: raw.oi ?? 0,
    volume: raw.volume ?? 0,
    iv: raw.implied_volatility ?? 0,
    bid: raw.top_bid_price ?? 0,
    ask: raw.top_ask_price ?? 0,
    delta: raw.greeks?.delta ?? 0,
    theta: raw.greeks?.theta ?? 0,
    gamma: raw.greeks?.gamma ?? 0,
    vega: raw.greeks?.vega ?? 0,
  };
}

export async function fetchExpiryList(
  instrument: IndexInstrument,
): Promise<string[]> {
  const { status, payload } = await dhanPost<ExpiryListResponse>(
    "/v2/optionchain/expirylist",
    {
      UnderlyingScrip: instrument.securityId,
      UnderlyingSeg: instrument.segment,
    },
  );

  if (status >= 400 || payload.status === "failed") {
    throw new DhanApiError(
      errorMessage(
        payload,
        `Failed to load expiries for ${instrument.name} (${status})`,
      ),
      status,
    );
  }

  return payload.data ?? [];
}

export async function fetchOptionChain(
  instrument: IndexInstrument,
  expiry: string,
): Promise<Omit<OptionChainData, "expiries" | "expiry">> {
  const { status, payload } = await dhanPost<OptionChainResponse>(
    "/v2/optionchain",
    {
      UnderlyingScrip: instrument.securityId,
      UnderlyingSeg: instrument.segment,
      Expiry: expiry,
    },
  );

  if (status >= 400 || payload.status === "failed") {
    throw new DhanApiError(
      errorMessage(
        payload,
        `Failed to load option chain for ${instrument.name} (${status})`,
      ),
      status,
    );
  }

  const oc = payload.data?.oc ?? {};
  const rows = Object.entries(oc)
    .map(([strikeKey, legs]) => ({
      strike: Number(strikeKey),
      ce: mapSide(legs.ce),
      pe: mapSide(legs.pe),
    }))
    .filter((row) => Number.isFinite(row.strike))
    .sort((a, b) => a.strike - b.strike);

  const spot = payload.data?.last_price ?? 0;

  return {
    spot,
    rows: takeStrikesAroundSpot(rows, spot, 30),
  };
}

function takeStrikesAroundSpot(
  rows: OptionChainRow[],
  spot: number,
  count: number,
) {
  if (rows.length <= count) return rows;

  let atmIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i += 1) {
    const distance = Math.abs(rows[i].strike - spot);
    if (distance < bestDistance) {
      bestDistance = distance;
      atmIndex = i;
    }
  }

  const half = Math.floor(count / 2);
  let start = Math.max(0, atmIndex - half);
  let end = start + count;
  if (end > rows.length) {
    end = rows.length;
    start = Math.max(0, end - count);
  }

  return rows.slice(start, end);
}

export async function loadOptionChainPage(
  instrument: IndexInstrument,
  requestedExpiry?: string | null,
): Promise<OptionChainData> {
  const expiries = await fetchExpiryList(instrument);
  if (expiries.length === 0) {
    throw new DhanApiError(`No expiries available for ${instrument.name}`, 404);
  }

  const expiry =
    requestedExpiry && expiries.includes(requestedExpiry)
      ? requestedExpiry
      : expiries[0];

  const chain = await fetchOptionChain(instrument, expiry);

  return {
    ...chain,
    expiry,
    expiries,
  };
}

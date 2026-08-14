import {
  DhanApiError,
  DhanConfigError,
  dhanPost,
  dhanRateLimitedPost,
  getDhanCredentials,
  isDhanSandbox,
} from "./config";
import {
  INDEX_INSTRUMENTS,
  buildQuote,
  type IndexInstrument,
  type IndexQuote,
} from "./instruments";
import {
  priorSessionFromSessions,
  sessionsFromChartArrays,
  todayIst,
} from "../strategies/expiry-day";

export {
  DhanApiError,
  DhanConfigError,
  getDhanCredentials,
  isDhanSandbox,
};

type OhlcResponse = {
  status?: string;
  data?: {
    IDX_I?: Record<
      string,
      {
        last_price?: number;
        ohlc?: {
          open?: number;
          high?: number;
          low?: number;
          close?: number;
        };
      }
    >;
  };
  remarks?: string;
  errorMessage?: string;
  message?: string;
};

type ChartResponse = {
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
  timestamp?: number[];
  errorMessage?: string;
  message?: string;
  remarks?: string;
};

export type PriorSessionStats = {
  day: string;
  high: number;
  low: number;
  close: number;
};

const priorCache = new Map<string, { asOf: string; value: PriorSessionStats }>();
const chartSessionCache = new Map<
  string,
  { asOf: string; sessions: ReturnType<typeof sessionsFromChartArrays> }
>();

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function fetchChartSessions(instrument: IndexInstrument) {
  const today = todayIst();
  const cached = chartSessionCache.get(instrument.id);
  if (cached?.asOf === today) return cached.sessions;

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 10);

  const { status, payload } = await dhanRateLimitedPost<ChartResponse>(
    "/v2/charts/historical",
    {
      securityId: String(instrument.securityId),
      exchangeSegment: "IDX_I",
      instrument: "INDEX",
      expiryCode: 0,
      fromDate: formatDate(from),
      toDate: formatDate(to),
    },
    "charts",
  );

  if (status >= 400) {
    throw new DhanApiError(
      payload.errorMessage ||
        payload.message ||
        payload.remarks ||
        `Dhan chart request failed for ${instrument.name} (${status})`,
      status,
    );
  }

  const sessions = sessionsFromChartArrays(
    payload.timestamp,
    payload.open ?? [],
    payload.high ?? [],
    payload.low ?? [],
    payload.close ?? [],
  );
  if (sessions.length > 0) {
    chartSessionCache.set(instrument.id, { asOf: today, sessions });
  }
  return sessions;
}

async function fetchQuoteFromCharts(
  instrument: IndexInstrument,
): Promise<IndexQuote> {
  const sessions = await fetchChartSessions(instrument);
  const today = todayIst();
  const latest =
    sessions
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.day) && s.day <= today)
      .at(-1) ?? sessions.at(-1);
  const prior = priorSessionFromSessions(sessions, today);
  const price = latest?.close;
  if (price === undefined) {
    throw new DhanApiError(
      `No chart candles returned for ${instrument.name}`,
      502,
    );
  }

  return buildQuote(instrument, {
    price,
    open: latest?.open ?? price,
    high: latest?.high ?? price,
    low: latest?.low ?? price,
    prevClose: prior?.close ?? price,
  });
}

export async function fetchPriorSessionStats(
  instrument: IndexInstrument,
): Promise<PriorSessionStats | null> {
  const today = todayIst();
  const hit = priorCache.get(instrument.id);
  if (hit?.asOf === today) return hit.value;

  try {
    const sessions = await fetchChartSessions(instrument);
    const prior = priorSessionFromSessions(sessions, today);
    if (!prior) return null;
    const value = {
      day: prior.day.startsWith("seq:") ? today : prior.day,
      high: prior.high,
      low: prior.low,
      close: prior.close,
    };
    priorCache.set(instrument.id, { asOf: today, value });
    return value;
  } catch {
    return null;
  }
}

async function fetchQuotesFromMarketfeed(): Promise<IndexQuote[]> {
  const { status, payload } = await dhanPost<OhlcResponse>(
    "/v2/marketfeed/ohlc",
    {
      IDX_I: INDEX_INSTRUMENTS.map((instrument) => instrument.securityId),
    },
  );

  if (status >= 400) {
    throw new DhanApiError(
      payload.errorMessage ||
        payload.message ||
        payload.remarks ||
        `Dhan OHLC request failed (${status})`,
      status,
    );
  }

  const idxData = payload.data?.IDX_I ?? {};

  return INDEX_INSTRUMENTS.map((instrument) => {
    const row = idxData[String(instrument.securityId)];
    if (!row?.last_price && row?.last_price !== 0) {
      throw new DhanApiError(
        `No quote returned for ${instrument.name} (${instrument.securityId})`,
        502,
      );
    }

    return buildQuote(instrument, {
      price: row.last_price,
      open: row.ohlc?.open,
      high: row.ohlc?.high,
      low: row.ohlc?.low,
      prevClose: row.ohlc?.close,
    });
  });
}

export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  if (isDhanSandbox()) {
    return Promise.all(
      INDEX_INSTRUMENTS.map((instrument) => fetchQuoteFromCharts(instrument)),
    );
  }

  return fetchQuotesFromMarketfeed();
}

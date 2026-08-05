import {
  DhanApiError,
  DhanConfigError,
  dhanPost,
  getDhanCredentials,
  isDhanSandbox,
} from "./config";
import {
  INDEX_INSTRUMENTS,
  buildQuote,
  type IndexInstrument,
  type IndexQuote,
} from "./instruments";

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

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lastNumber(values: number[] | undefined) {
  if (!values || values.length === 0) return undefined;
  return values[values.length - 1];
}

function firstNumber(values: number[] | undefined) {
  if (!values || values.length === 0) return undefined;
  return values[0];
}

async function fetchQuoteFromCharts(
  instrument: IndexInstrument,
): Promise<IndexQuote> {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);

  const { status, payload } = await dhanPost<ChartResponse>(
    "/v2/charts/historical",
    {
      securityId: String(instrument.securityId),
      exchangeSegment: "IDX_I",
      instrument: "INDEX",
      expiryCode: 0,
      fromDate: formatDate(from),
      toDate: formatDate(to),
    },
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

  const closes = payload.close ?? [];
  const opens = payload.open ?? [];
  const highs = payload.high ?? [];
  const lows = payload.low ?? [];

  const price = lastNumber(closes);
  if (price === undefined) {
    throw new DhanApiError(
      `No chart candles returned for ${instrument.name}`,
      502,
    );
  }

  const prevClose =
    closes.length > 1 ? closes[closes.length - 2] : (firstNumber(opens) ?? price);

  return buildQuote(instrument, {
    price,
    open: firstNumber(opens) ?? price,
    high: highs.length ? Math.max(...highs) : price,
    low: lows.length ? Math.min(...lows) : price,
    prevClose,
  });
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

export type IndexId = "NIFTY" | "BANKNIFTY" | "SENSEX";

export type IndexInstrument = {
  id: IndexId;
  name: string;
  securityId: number;
  segment: "IDX_I";
};

export const INDEX_INSTRUMENTS: IndexInstrument[] = [
  { id: "NIFTY", name: "Nifty 50", securityId: 13, segment: "IDX_I" },
  { id: "BANKNIFTY", name: "Bank Nifty", securityId: 25, segment: "IDX_I" },
  { id: "SENSEX", name: "Sensex", securityId: 51, segment: "IDX_I" },
];

export const SECURITY_ID_TO_INDEX = new Map(
  INDEX_INSTRUMENTS.map((instrument) => [instrument.securityId, instrument]),
);

export function getIndexByParam(id: string | undefined) {
  if (!id) return undefined;
  const normalized = id.trim().toUpperCase();
  return INDEX_INSTRUMENTS.find((instrument) => instrument.id === normalized);
}

export type IndexQuote = {
  id: IndexId;
  name: string;
  securityId: number;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  updatedAt: string;
};

export type FeedStatus = "disconnected" | "connecting" | "connected" | "error";

export function buildQuote(
  instrument: IndexInstrument,
  fields: {
    price: number;
    open?: number;
    high?: number;
    low?: number;
    prevClose?: number;
  },
): IndexQuote {
  const prevClose = fields.prevClose ?? fields.price;
  const change = fields.price - prevClose;
  const changePercent = prevClose === 0 ? 0 : (change / prevClose) * 100;

  return {
    id: instrument.id,
    name: instrument.name,
    securityId: instrument.securityId,
    price: fields.price,
    change,
    changePercent,
    open: fields.open ?? fields.price,
    high: fields.high ?? fields.price,
    low: fields.low ?? fields.price,
    prevClose,
    updatedAt: new Date().toISOString(),
  };
}

export const FEED_RESPONSE = {
  INDEX: 1,
  TICKER: 2,
  QUOTE: 4,
  OI: 5,
  PREV_CLOSE: 6,
  MARKET_STATUS: 7,
  FULL: 8,
  DISCONNECT: 50,
} as const;

export type PacketHeader = {
  feedCode: number;
  messageLength: number;
  exchangeSegment: number;
  securityId: number;
};

export type QuotePacket = {
  ltp: number;
  lastTradedQty: number;
  lastTradeTime: number;
  averagePrice: number;
  volume: number;
  totalSellQty: number;
  totalBuyQty: number;
  open: number;
  close: number;
  high: number;
  low: number;
};

export type PrevClosePacket = {
  prevClose: number;
  prevOi: number;
};

function readFloat32LE(view: DataView, offset: number) {
  return view.getFloat32(offset, true);
}

function readInt16LE(view: DataView, offset: number) {
  return view.getInt16(offset, true);
}

function readInt32LE(view: DataView, offset: number) {
  return view.getInt32(offset, true);
}

export function parseHeader(buffer: Buffer): PacketHeader {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    feedCode: view.getUint8(0),
    messageLength: readInt16LE(view, 1),
    exchangeSegment: view.getUint8(3),
    securityId: readInt32LE(view, 4),
  };
}

export function parseQuotePacket(buffer: Buffer): QuotePacket {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    ltp: readFloat32LE(view, 8),
    lastTradedQty: readInt16LE(view, 12),
    lastTradeTime: readInt32LE(view, 14),
    averagePrice: readFloat32LE(view, 18),
    volume: readInt32LE(view, 22),
    totalSellQty: readInt32LE(view, 26),
    totalBuyQty: readInt32LE(view, 30),
    open: readFloat32LE(view, 34),
    close: readFloat32LE(view, 38),
    high: readFloat32LE(view, 42),
    low: readFloat32LE(view, 46),
  };
}

export function parsePrevClosePacket(buffer: Buffer): PrevClosePacket {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    prevClose: readFloat32LE(view, 8),
    prevOi: readInt32LE(view, 12),
  };
}

/** Index packet (feed code 1) — LTP + LTT for indices */
export function parseIndexPacket(buffer: Buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    ltp: readFloat32LE(view, 8),
    lastTradeTime: readInt32LE(view, 12),
  };
}

import WebSocket from "ws";
import {
  FEED_RESPONSE,
  parseHeader,
  parseIndexPacket,
  parsePrevClosePacket,
  parseQuotePacket,
} from "./binary";
import { isDhanSandbox, resolveDhanCredentials } from "./config";
import {
  INDEX_INSTRUMENTS,
  SECURITY_ID_TO_INDEX,
  buildQuote,
  type FeedStatus,
  type IndexQuote,
} from "./instruments";
import { fetchIndexQuotes } from "./quotes";

export type { FeedStatus };

type FeedSnapshot = {
  status: FeedStatus;
  error: string | null;
  mode: "websocket" | "polling";
  quotes: Record<string, IndexQuote>;
};

type Listener = (snapshot: FeedSnapshot) => void;

const QUOTE_SUBSCRIBE_CODE = 17;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const SANDBOX_POLL_MS = 15_000;

class DhanMarketFeed {
  private socket: WebSocket | null = null;
  private status: FeedStatus = "disconnected";
  private error: string | null = null;
  private mode: "websocket" | "polling" = "websocket";
  private quotes = new Map<number, IndexQuote>();
  private prevClose = new Map<number, number>();
  private listeners = new Set<Listener>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private started = false;
  private polling = false;

  start() {
    if (this.started) return;
    this.started = true;

    if (isDhanSandbox()) {
      this.mode = "polling";
      this.startPolling();
      return;
    }

    this.mode = "websocket";
    void this.connect();
  }

  seedQuotes(quotes: IndexQuote[]) {
    for (const quote of quotes) {
      this.quotes.set(quote.securityId, quote);
      this.prevClose.set(quote.securityId, quote.prevClose);
    }
    this.emit();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): FeedSnapshot {
    const quotes: Record<string, IndexQuote> = {};
    for (const quote of this.quotes.values()) {
      quotes[quote.id] = quote;
    }
    return {
      status: this.status,
      error: this.error,
      mode: this.mode,
      quotes,
    };
  }

  private setStatus(status: FeedStatus, error: string | null = null) {
    this.status = status;
    this.error = error;
    this.emit();
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private startPolling() {
    this.setStatus("connecting");
    void this.pollOnce();

    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, SANDBOX_POLL_MS);
  }

  private async pollOnce() {
    if (this.polling) return;
    this.polling = true;

    try {
      const quotes = await fetchIndexQuotes();
      this.seedQuotes(quotes);
      this.setStatus("connected");
    } catch (error) {
      this.setStatus(
        "error",
        error instanceof Error
          ? error.message
          : "Sandbox quote polling failed",
      );
    } finally {
      this.polling = false;
    }
  }

  private async connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    let credentials: { clientId: string; accessToken: string };
    try {
      credentials = await resolveDhanCredentials();
    } catch (error) {
      this.setStatus(
        "error",
        error instanceof Error ? error.message : "Missing Dhan credentials",
      );
      // Keep retrying (with backoff) so the feed recovers once a token is
      // available — e.g. after logging in on the Settings page.
      this.scheduleReconnect();
      return;
    }

    this.intentionalClose = false;
    this.setStatus("connecting");

    const url = new URL("wss://api-feed.dhan.co");
    url.searchParams.set("version", "2");
    url.searchParams.set("token", credentials.accessToken);
    url.searchParams.set("clientId", credentials.clientId);
    url.searchParams.set("authType", "2");

    const socket = new WebSocket(url.toString());
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.subscribeInstruments();
    });

    socket.on("message", (data) => {
      const buffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      this.handleBinaryMessage(buffer);
    });

    socket.on("error", (err) => {
      this.setStatus("error", err.message || "Dhan WebSocket error");
    });

    socket.on("close", () => {
      this.socket = null;
      if (this.intentionalClose) {
        this.setStatus("disconnected");
        return;
      }
      this.setStatus("connecting", "Feed disconnected — reconnecting…");
      this.scheduleReconnect();
    });
  }

  private subscribeInstruments() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const message = {
      RequestCode: QUOTE_SUBSCRIBE_CODE,
      InstrumentCount: INDEX_INSTRUMENTS.length,
      InstrumentList: INDEX_INSTRUMENTS.map((instrument) => ({
        ExchangeSegment: instrument.segment,
        SecurityId: String(instrument.securityId),
      })),
    };

    this.socket.send(JSON.stringify(message));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private handleBinaryMessage(buffer: Buffer) {
    if (buffer.byteLength < 8) return;

    const header = parseHeader(buffer);
    const instrument = SECURITY_ID_TO_INDEX.get(header.securityId);
    if (!instrument) return;

    if (header.feedCode === FEED_RESPONSE.PREV_CLOSE) {
      const packet = parsePrevClosePacket(buffer);
      this.prevClose.set(header.securityId, packet.prevClose);
      const existing = this.quotes.get(header.securityId);
      if (existing) {
        this.quotes.set(
          header.securityId,
          buildQuote(instrument, {
            price: existing.price,
            open: existing.open,
            high: existing.high,
            low: existing.low,
            prevClose: packet.prevClose,
          }),
        );
        this.emit();
      }
      return;
    }

    if (header.feedCode === FEED_RESPONSE.QUOTE) {
      const packet = parseQuotePacket(buffer);
      const prevClose =
        this.prevClose.get(header.securityId) ??
        (packet.close > 0 ? packet.close : packet.ltp);

      this.quotes.set(
        header.securityId,
        buildQuote(instrument, {
          price: packet.ltp,
          open: packet.open,
          high: packet.high,
          low: packet.low,
          prevClose,
        }),
      );
      this.emit();
      return;
    }

    if (
      header.feedCode === FEED_RESPONSE.INDEX ||
      header.feedCode === FEED_RESPONSE.TICKER
    ) {
      const ltp =
        header.feedCode === FEED_RESPONSE.INDEX
          ? parseIndexPacket(buffer).ltp
          : new DataView(
              buffer.buffer,
              buffer.byteOffset,
              buffer.byteLength,
            ).getFloat32(8, true);

      const existing = this.quotes.get(header.securityId);
      const prevClose =
        this.prevClose.get(header.securityId) ??
        existing?.prevClose ??
        ltp;

      this.quotes.set(
        header.securityId,
        buildQuote(instrument, {
          price: ltp,
          open: existing?.open ?? ltp,
          high: existing ? Math.max(existing.high, ltp) : ltp,
          low: existing ? Math.min(existing.low, ltp) : ltp,
          prevClose,
        }),
      );
      this.emit();
      return;
    }

    if (header.feedCode === FEED_RESPONSE.DISCONNECT) {
      this.setStatus("error", "Dhan feed disconnected by server");
    }
  }
}

const globalForFeed = globalThis as typeof globalThis & {
  __dhanMarketFeed?: DhanMarketFeed;
};

export function getMarketFeed() {
  if (!globalForFeed.__dhanMarketFeed) {
    globalForFeed.__dhanMarketFeed = new DhanMarketFeed();
  }
  return globalForFeed.__dhanMarketFeed;
}

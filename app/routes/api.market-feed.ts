import type { Route } from "./+types/api.market-feed";
import { getMarketFeed } from "../lib/dhan/feed";
import { fetchIndexQuotes } from "../lib/dhan/quotes";

export async function loader({ request }: Route.LoaderArgs) {
  const feed = getMarketFeed();

  if (Object.keys(feed.getSnapshot().quotes).length === 0) {
    try {
      const snapshot = await fetchIndexQuotes();
      feed.seedQuotes(snapshot);
    } catch {
      // Live feed may still populate quotes; home loader already surfaces REST errors.
    }
  }

  feed.start();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const unsubscribe = feed.subscribe((snapshot) => {
        send("quotes", snapshot);
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      // abort handler performs cleanup
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

import type { Route } from "./+types/api.backtest-job";
import { peekBacktestJob } from "../lib/lab/backtest-job";

export async function loader({ request }: Route.LoaderArgs) {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    return Response.json(
      { job: peekBacktestJob() },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: job\ndata: ${JSON.stringify(peekBacktestJob())}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };

      const timer = setInterval(send, 1000);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send();
      request.signal.addEventListener("abort", cleanup);
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

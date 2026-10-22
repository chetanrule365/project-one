import type { Route } from "./+types/api.trades.id.delete";
import { isDemoRequest } from "../lib/demo.server";
import { bootSession } from "../lib/session.server";
import { deletePaperTrade, pullPaperStore } from "../lib/lab/paper-store.server";

export async function action({ params, request }: Route.ActionArgs) {
  if (request.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tradeId = Number(params.id);

  if (!Number.isInteger(tradeId) || tradeId < 0) {
    return new Response(JSON.stringify({ error: "Invalid trade ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await bootSession(request, "api");
    if (isDemoRequest(request)) {
      return new Response(
        JSON.stringify({ error: "Demo is read-only." }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    await pullPaperStore();
    const deletedTrade = deletePaperTrade(tradeId);
    if (!deletedTrade) {
      return new Response(
        JSON.stringify({ error: `Trade ID ${tradeId} not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Trade ID ${tradeId} deleted successfully`,
        deletedTrade,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error deleting trade:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete trade",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

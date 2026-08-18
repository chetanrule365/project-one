import type { Route } from "./+types/trades.delete";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "../lib/data-dir";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const tradeId = Number(url.searchParams.get("id"));

  if (!Number.isInteger(tradeId) || tradeId < 0) {
    return new Response(JSON.stringify({ error: "Invalid trade ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const dataDir = getDataDir();
    const filePath = path.join(dataDir, "paper.json");

    if (!existsSync(filePath)) {
      return new Response(
        JSON.stringify({ error: "Paper trades file not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = JSON.parse(readFileSync(filePath, "utf8"));

    const tradeIndex = data.trades.findIndex((t: any) => t.id === tradeId);
    if (tradeIndex === -1) {
      return new Response(
        JSON.stringify({ error: `Trade ID ${tradeId} not found` }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const deletedTrade = data.trades[tradeIndex];
    data.trades.splice(tradeIndex, 1);

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, filePath);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Trade ID ${tradeId} deleted successfully`,
        deletedTrade,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
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
      }
    );
  }
}


import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("strategies", "routes/strategies.tsx"),
  route("paper", "routes/paper.tsx"),
  route("backtesting", "routes/backtesting.tsx"),
  route("option-chain", "routes/option-chain.tsx"),
  route("option-chain/:id", "routes/option-chain.$id.tsx"),
  route("settings", "routes/settings.tsx"),
  route("api/market-feed", "routes/api.market-feed.ts"),
  route("api/paper-trades.csv", "routes/api.paper-trades-export.ts"),
  route("api/trades/:id/delete", "routes/api.trades.id.delete.ts"),
] satisfies RouteConfig;


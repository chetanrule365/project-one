import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("strategies", "routes/strategies.tsx"),
  route("backtesting", "routes/backtesting.tsx"),
  route("option-chain", "routes/option-chain.tsx"),
  route("option-chain/:id", "routes/option-chain.$id.tsx"),
  route("api/market-feed", "routes/api.market-feed.ts"),
] satisfies RouteConfig;

import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("index/:id", "routes/index.$id.tsx"),
  route("lab", "routes/lab.tsx"),
  route("api/market-feed", "routes/api.market-feed.ts"),
] satisfies RouteConfig;

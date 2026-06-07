import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sessions/:sessionId", "routes/session.tsx"),
  route("api/spots/stream", "routes/api.spots.stream.ts"),
  route("api/spots/photo", "routes/api.spots.photo.ts"),
] satisfies RouteConfig;

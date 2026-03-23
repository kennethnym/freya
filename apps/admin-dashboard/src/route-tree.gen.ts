import { Route as rootRoute } from "./routes/__root"
import { Route as loginRoute } from "./routes/login"
import { Route as dashboardRoute } from "./routes/_dashboard"
import { Route as dashboardIndexRoute } from "./routes/_dashboard/index"
import { Route as dashboardFeedRoute } from "./routes/_dashboard/feed"
import { Route as dashboardSourceRoute } from "./routes/_dashboard/sources.$sourceId"

export const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute.addChildren([
    dashboardIndexRoute,
    dashboardFeedRoute,
    dashboardSourceRoute,
  ]),
])

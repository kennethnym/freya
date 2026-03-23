import { createRoute } from "@tanstack/react-router"

import { FeedPanel } from "@/components/feed-panel"
import { Route as dashboardRoute } from "../_dashboard"

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/feed",
  component: FeedPanel,
})

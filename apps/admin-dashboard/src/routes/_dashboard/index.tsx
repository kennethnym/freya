import { createRoute } from "@tanstack/react-router"

import { GeneralSettingsPanel } from "@/components/general-settings-panel"
import { Route as dashboardRoute } from "../_dashboard"

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/",
  component: GeneralSettingsPanel,
})

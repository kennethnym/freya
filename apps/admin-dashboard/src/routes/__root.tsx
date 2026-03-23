import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: function RootLayout() {
    return (
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
    )
  },
})

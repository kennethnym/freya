import { createRoute } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"

import { fetchSources } from "@/lib/api"
import { SourceConfigPanel } from "@/components/source-config-panel"
import { Route as dashboardRoute } from "../_dashboard"

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/sources/$sourceId",
  component: SourceRoute,
})

function SourceRoute() {
  const { sourceId } = Route.useParams()
  const queryClient = useQueryClient()
  const sources = queryClient.getQueryData<Awaited<ReturnType<typeof fetchSources>>>(["sources"]) ?? []
  const source = sources.find((s) => s.id === sourceId)

  if (!source) {
    return <p className="text-sm text-muted-foreground">Source not found.</p>
  }

  return (
    <SourceConfigPanel
      key={source.id}
      source={source}
      onUpdate={() => queryClient.invalidateQueries({ queryKey: ["configs"] })}
    />
  )
}

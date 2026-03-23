import { useQuery } from "@tanstack/react-query"
import { CircleCheck, CircleX, Loader2 } from "lucide-react"

import { getServerUrl } from "@/lib/server-url"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

async function checkHealth(serverUrl: string): Promise<boolean> {
  const res = await fetch(`${serverUrl}/health`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { status: string }
  if (data.status !== "ok") throw new Error("Unexpected response")
  return true
}

export function GeneralSettingsPanel() {
  const serverUrl = getServerUrl()

  const { isLoading, isError, error } = useQuery({
    queryKey: ["health", serverUrl],
    queryFn: () => checkHealth(serverUrl),
  })

  const status = isLoading ? "checking" : isError ? "error" : "ok"
  const errorMsg = error instanceof Error ? error.message : null

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">General</h2>
        <p className="text-sm text-muted-foreground">
          Backend server information.
        </p>
      </div>

      <Card className="-mx-4">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm">Server</CardTitle>
          <CardDescription>
            Connected backend instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-muted-foreground">URL</span>
              <span className="select-text truncate font-mono text-xs">{serverUrl}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              {status === "checking" && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Checking…
                </span>
              )}
              {status === "ok" && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CircleCheck className="size-3.5 text-primary" />
                  Connected
                </span>
              )}
              {status === "error" && (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <CircleX className="size-3.5" />
                  {errorMsg ?? "Unreachable"}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

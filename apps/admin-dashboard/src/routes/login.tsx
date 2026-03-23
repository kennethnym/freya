import { createRoute, useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"

import type { AuthSession } from "@/lib/auth"
import { LoginPage } from "@/components/login-page"
import { Route as rootRoute } from "./__root"

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: function LoginRoute() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    function handleLogin(session: AuthSession) {
      queryClient.setQueryData(["session"], session)
      navigate({ to: "/" })
    }

    return <LoginPage onLogin={handleLogin} />
  },
})

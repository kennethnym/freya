import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"

import { routeTree } from "./route-tree.gen"

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	context: {
		queryClient: undefined! as QueryClient,
	},
})

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}

export function App() {
	const queryClient = useQueryClient()
	return <RouterProvider router={router} context={{ queryClient }} />
}

export default App

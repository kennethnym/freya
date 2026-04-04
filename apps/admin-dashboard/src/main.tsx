import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/sonner.tsx"

import App from "./App.tsx"

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
})

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<App />
				<Toaster />
			</ThemeProvider>
		</QueryClientProvider>
	</StrictMode>,
)

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
	createRoute,
	Outlet,
	redirect,
	useMatchRoute,
	useNavigate,
	Link,
} from "@tanstack/react-router"
import {
	Calendar,
	CalendarDays,
	CircleDot,
	CloudSun,
	Loader2,
	TrainFront,
	LogOut,
	Map as MapIcon,
	MapPin,
	Rss,
	Server,
	TriangleAlert,
} from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar"
import { fetchConfigs, fetchSources } from "@/lib/api"
import { getSession, signOut } from "@/lib/auth"

import { Route as rootRoute } from "./__root"

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
	"freya.location": MapPin,
	"freya.weather": CloudSun,
	"freya.caldav": CalendarDays,
	"freya.google-calendar": Calendar,
	"freya.google-maps": MapIcon,
	"freya.tfl": TrainFront,
}

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	id: "dashboard",
	beforeLoad: async ({ context }) => {
		let session: Awaited<ReturnType<typeof getSession>> | null = null
		try {
			session = await context.queryClient.ensureQueryData({
				queryKey: ["session"],
				queryFn: getSession,
			})
		} catch {
			throw redirect({ to: "/login" })
		}
		if (!session?.user) {
			throw redirect({ to: "/login" })
		}
		return { user: session.user }
	},
	component: DashboardLayout,
	pendingComponent: () => (
		<div className="flex min-h-svh items-center justify-center">
			<Loader2 className="size-5 animate-spin text-muted-foreground" />
		</div>
	),
})

function DashboardLayout() {
	const { user } = Route.useRouteContext()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const matchRoute = useMatchRoute()

	const { data: sources = [] } = useQuery({
		queryKey: ["sources"],
		queryFn: fetchSources,
	})

	const {
		data: configs = [],
		error: configsError,
		refetch: refetchConfigs,
	} = useQuery({
		queryKey: ["configs"],
		queryFn: fetchConfigs,
	})

	const logoutMutation = useMutation({
		mutationFn: signOut,
		onSuccess() {
			queryClient.setQueryData(["session"], null)
			queryClient.clear()
			navigate({ to: "/login" })
		},
	})

	const error = configsError?.message ?? null
	const configMap = new Map(configs.map((c) => [c.sourceId, c]))

	return (
		<SidebarProvider>
			<Sidebar>
				<SidebarHeader>
					<div className="flex items-center justify-between px-2 py-1">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{user.name}</p>
							<p className="truncate text-xs text-muted-foreground">{user.email}</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={() => logoutMutation.mutate()}
						>
							<LogOut className="size-3.5" />
						</Button>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>General</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton isActive={!!matchRoute({ to: "/" })} asChild>
										<Link to="/">
											<Server className="size-4" />
											<span>Server</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton isActive={!!matchRoute({ to: "/feed" })} asChild>
										<Link to="/feed">
											<Rss className="size-4" />
											<span>Feed</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>

					<SidebarGroup>
						<SidebarGroupLabel>Sources</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{sources.map((source) => {
									const Icon = SOURCE_ICONS[source.id] ?? CircleDot
									const cfg = configMap.get(source.id)
									const isEnabled = source.alwaysEnabled || cfg?.enabled
									return (
										<SidebarMenuItem key={source.id}>
											<SidebarMenuButton
												isActive={
													!!matchRoute({
														to: "/sources/$sourceId",
														params: { sourceId: source.id },
													})
												}
												asChild
											>
												<Link to="/sources/$sourceId" params={{ sourceId: source.id }}>
													<Icon className="size-4" />
													<span>{source.name}</span>
												</Link>
											</SidebarMenuButton>
											{isEnabled && (
												<SidebarMenuBadge>
													<CircleDot className="size-2.5 text-primary" />
												</SidebarMenuBadge>
											)}
										</SidebarMenuItem>
									)
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>

			<SidebarInset>
				<header className="flex h-12 items-center gap-2 border-b px-4">
					<SidebarTrigger className="-ml-1" />
					<Separator orientation="vertical" className="mr-2 !h-4" />
				</header>

				<main className="flex-1 p-6">
					{error && (
						<Alert variant="destructive" className="mb-6">
							<TriangleAlert className="size-4" />
							<AlertDescription className="flex items-center justify-between">
								<span>{error}</span>
								<Button variant="ghost" size="sm" onClick={() => refetchConfigs()}>
									Retry
								</Button>
							</AlertDescription>
						</Alert>
					)}

					<Outlet />
				</main>
			</SidebarInset>
		</SidebarProvider>
	)
}

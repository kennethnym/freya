import { useMutation } from "@tanstack/react-query"
import { Loader2, Settings2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import type { AuthSession } from "@/lib/auth"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from "@/lib/auth"
import { getServerUrl, setServerUrl } from "@/lib/server-url"

interface LoginPageProps {
	onLogin: (session: AuthSession) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
	const [serverUrlInput, setServerUrlInput] = useState(getServerUrl)
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")

	const loginMutation = useMutation({
		mutationFn: async () => {
			setServerUrl(serverUrlInput)
			return signIn(email, password)
		},
		onSuccess(session) {
			onLogin(session)
		},
		onError(err) {
			toast.error(err.message)
		},
	})

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		loginMutation.mutate()
	}

	const loading = loginMutation.isPending

	return (
		<div className="flex min-h-svh items-center justify-center bg-background p-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10">
						<Settings2 className="size-5 text-primary" />
					</div>
					<CardTitle>Admin Dashboard</CardTitle>
					<CardDescription>Sign in to manage source configuration.</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="server-url">Server URL</Label>
							<Input
								id="server-url"
								type="url"
								value={serverUrlInput}
								onChange={(e) => setServerUrlInput(e.target.value)}
								placeholder="http://localhost:3000"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="admin@freya.local"
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
							/>
						</div>

						<Button type="submit" className="w-full" disabled={loading}>
							{loading && <Loader2 className="size-4 animate-spin" />}
							{loading ? "Signing in…" : "Sign in"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}

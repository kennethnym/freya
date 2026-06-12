import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Info, Loader2, MapPin, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import type { ConfigFieldDef, SourceDefinition } from "@/lib/api"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fetchSourceConfig, pushLocation, replaceSource, updateProviderConfig } from "@/lib/api"

interface SourceConfigPanelProps {
	source: SourceDefinition
	onUpdate: () => void
}

export function SourceConfigPanel({ source, onUpdate }: SourceConfigPanelProps) {
	const queryClient = useQueryClient()
	const [dirty, setDirty] = useState<Record<string, unknown>>({})

	const { data: serverConfig, isLoading } = useQuery({
		queryKey: ["sourceConfig", source.id],
		queryFn: () => fetchSourceConfig(source.id),
	})

	const enabled = serverConfig?.enabled ?? false
	const serverValues = buildInitialValues(source.fields, serverConfig?.config)
	const formValues = { ...serverValues, ...dirty }

	function isCredentialField(field: ConfigFieldDef): boolean {
		return !!(field.secret && field.required)
	}

	function getUserConfig(): Record<string, unknown> {
		const result: Record<string, unknown> = {}
		for (const [name, value] of Object.entries(formValues)) {
			const field = source.fields[name]
			if (field && !isCredentialField(field)) {
				result[name] = value
			}
		}
		return result
	}

	function getCredentialFields(): Record<string, unknown> {
		const creds: Record<string, unknown> = {}
		for (const [name, value] of Object.entries(formValues)) {
			const field = source.fields[name]
			if (field && isCredentialField(field)) {
				creds[name] = value
			}
		}
		return creds
	}

	function buildReplaceBody(enabledValue: boolean): Parameters<typeof replaceSource>[1] {
		const body: Parameters<typeof replaceSource>[1] = { enabled: enabledValue }
		if (Object.keys(source.fields).length > 0) {
			body.config = getUserConfig()
		}
		return body
	}

	function invalidate() {
		queryClient.invalidateQueries({ queryKey: ["sourceConfig", source.id] })
		queryClient.invalidateQueries({ queryKey: ["configs"] })
		onUpdate()
	}

	const saveMutation = useMutation({
		mutationFn: async () => {
			const credentialFields = getCredentialFields()
			const hasCredentials = Object.values(credentialFields).some(
				(v) => typeof v === "string" && v.length > 0,
			)

			const body = buildReplaceBody(enabled)
			if (hasCredentials && source.perUserCredentials) {
				body.credentials = credentialFields
			}
			await replaceSource(source.id, body)

			// For non-per-user credentials (provider-level), still use the admin endpoint.
			if (hasCredentials && !source.perUserCredentials) {
				await updateProviderConfig(source.id, { credentials: credentialFields })
			}
		},
		onSuccess() {
			setDirty({})
			invalidate()
			toast.success("Configuration saved")
		},
		onError(err) {
			toast.error(err.message)
		},
	})

	const toggleMutation = useMutation({
		mutationFn: (checked: boolean) => replaceSource(source.id, buildReplaceBody(checked)),
		onSuccess(_data, checked) {
			invalidate()
			toast.success(`Source ${checked ? "enabled" : "disabled"}`)
		},
		onError(err) {
			toast.error(err.message)
		},
	})

	const deleteMutation = useMutation({
		mutationFn: () => replaceSource(source.id, buildReplaceBody(false)),
		onSuccess() {
			setDirty({})
			invalidate()
			toast.success("Configuration deleted")
		},
		onError(err) {
			toast.error(err.message)
		},
	})

	function handleFieldChange(fieldName: string, value: unknown) {
		setDirty((prev) => ({ ...prev, [fieldName]: value }))
	}

	const fieldEntries = Object.entries(source.fields)
	const hasFields = fieldEntries.length > 0
	const busy = saveMutation.isPending || toggleMutation.isPending || deleteMutation.isPending

	const requiredFields = fieldEntries.filter(([, f]) => f.required)
	const optionalFields = fieldEntries.filter(([, f]) => !f.required)

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="size-5 animate-spin text-muted-foreground" />
			</div>
		)
	}

	return (
		<div className="mx-auto max-w-xl space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-1">
					<div className="flex items-center gap-3">
						<h2 className="text-lg font-semibold tracking-tight">{source.name}</h2>
						{source.alwaysEnabled ? (
							<Badge variant="secondary">Always on</Badge>
						) : enabled ? (
							<Badge className="bg-primary/10 text-primary">Enabled</Badge>
						) : (
							<Badge variant="outline">Disabled</Badge>
						)}
					</div>
					<p className="text-sm text-muted-foreground">{source.description}</p>
				</div>
				{!source.alwaysEnabled && (
					<Switch
						checked={enabled}
						onCheckedChange={(checked) => toggleMutation.mutate(checked)}
						disabled={busy}
					/>
				)}
			</div>

			{/* Config form */}
			{hasFields && !source.alwaysEnabled && (
				<>
					{/* Required fields */}
					{requiredFields.length > 0 && (
						<Card className="-mx-4">
							<CardHeader className="pb-4">
								<CardTitle className="text-sm">Credentials</CardTitle>
								<CardDescription>Required fields to connect this source.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{requiredFields.map(([name, field]) => (
									<FieldInput
										key={name}
										name={name}
										field={field}
										value={formValues[name]}
										onChange={(v) => handleFieldChange(name, v)}
										disabled={busy}
									/>
								))}
							</CardContent>
						</Card>
					)}

					{/* Optional fields */}
					{optionalFields.length > 0 && (
						<Card className="-mx-4">
							<CardHeader className="pb-4">
								<CardTitle className="text-sm">Options</CardTitle>
								<CardDescription>Optional configuration for this source.</CardDescription>
							</CardHeader>
							<CardContent>
								<div className={`grid gap-4 ${optionalFields.length > 1 ? "grid-cols-2" : ""}`}>
									{optionalFields.map(([name, field]) => (
										<FieldInput
											key={name}
											name={name}
											field={field}
											value={formValues[name]}
											onChange={(v) => handleFieldChange(name, v)}
											disabled={busy}
										/>
									))}
								</div>
							</CardContent>
						</Card>
					)}

					{/* Actions */}
					<div className="flex items-center justify-end gap-3">
						{serverConfig && (
							<Button
								onClick={() => deleteMutation.mutate()}
								disabled={busy}
								variant="outline"
								className="text-destructive hover:text-destructive"
							>
								{deleteMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Trash2 className="size-4" />
								)}
								{deleteMutation.isPending ? "Deleting…" : "Delete configuration"}
							</Button>
						)}
						<Button onClick={() => saveMutation.mutate()} disabled={busy}>
							{saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							{saveMutation.isPending ? "Saving…" : "Save configuration"}
						</Button>
					</div>
				</>
			)}

			{/* Always-on sources */}
			{source.alwaysEnabled && source.id !== "freya.location" && (
				<>
					<Separator />
					<p className="text-sm text-muted-foreground">
						This source is always enabled and requires no configuration.
					</p>
				</>
			)}

			{source.id === "freya.location" && <LocationCard />}
		</div>
	)
}

function LocationCard() {
	const [lat, setLat] = useState("")
	const [lng, setLng] = useState("")

	const locationMutation = useMutation({
		mutationFn: (coords: { lat: number; lng: number }) =>
			pushLocation({ lat: coords.lat, lng: coords.lng, accuracy: 10 }),
		onSuccess() {
			toast.success("Location updated")
		},
		onError(err) {
			toast.error(err.message)
		},
	})

	function handlePush() {
		const latNum = parseFloat(lat)
		const lngNum = parseFloat(lng)
		if (isNaN(latNum) || isNaN(lngNum)) return
		locationMutation.mutate({ lat: latNum, lng: lngNum })
	}

	function handleUseDevice() {
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setLat(String(pos.coords.latitude))
				setLng(String(pos.coords.longitude))
				locationMutation.mutate({
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
				})
			},
			(err) => {
				locationMutation.reset()
				alert(`Geolocation error: ${err.message}`)
			},
		)
	}

	return (
		<Card className="-mx-4">
			<CardHeader className="pb-4">
				<CardTitle className="text-sm">Push Location</CardTitle>
				<CardDescription>Send a location update to the backend.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label htmlFor="loc-lat" className="text-xs font-medium">
							Latitude
						</Label>
						<Input
							id="loc-lat"
							type="number"
							step="any"
							value={lat}
							onChange={(e) => setLat(e.target.value)}
							placeholder="51.5074"
							disabled={locationMutation.isPending}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="loc-lng" className="text-xs font-medium">
							Longitude
						</Label>
						<Input
							id="loc-lng"
							type="number"
							step="any"
							value={lng}
							onChange={(e) => setLng(e.target.value)}
							placeholder="-0.1278"
							disabled={locationMutation.isPending}
						/>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<Button
						size="sm"
						variant="outline"
						onClick={handleUseDevice}
						disabled={locationMutation.isPending}
					>
						<MapPin className="size-3.5" />
						Use device location
					</Button>
					<Button
						size="sm"
						onClick={handlePush}
						disabled={locationMutation.isPending || !lat || !lng}
					>
						{locationMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
						Push
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}

function FieldInput({
	name,
	field,
	value,
	onChange,
	disabled,
}: {
	name: string
	field: ConfigFieldDef
	value: unknown
	onChange: (value: unknown) => void
	disabled?: boolean
}) {
	const labelContent = (
		<div className="flex items-center gap-1.5">
			<span>{field.label}</span>
			{field.required && <span className="text-destructive">*</span>}
			{field.description && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Info className="size-3 text-muted-foreground cursor-help" />
					</TooltipTrigger>
					<TooltipContent side="top" className="max-w-xs text-xs">
						{field.description}
					</TooltipContent>
				</Tooltip>
			)}
		</div>
	)

	if (field.type === "select" && field.options) {
		return (
			<div className="space-y-2">
				<Label htmlFor={name} className="text-xs font-medium">
					{labelContent}
				</Label>
				<Select value={String(value ?? "")} onValueChange={onChange} disabled={disabled}>
					<SelectTrigger id={name}>
						<SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
					</SelectTrigger>
					<SelectContent>
						{field.options.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		)
	}

	if (field.type === "multiselect" && field.options) {
		const selected = Array.isArray(value) ? (value as string[]) : []

		function toggle(optValue: string) {
			const next = selected.includes(optValue)
				? selected.filter((v) => v !== optValue)
				: [...selected, optValue]
			onChange(next)
		}

		return (
			<div className="space-y-2">
				<Label className="text-xs font-medium">{labelContent}</Label>
				<div className="flex flex-wrap gap-1.5">
					{field.options!.map((opt) => {
						const isSelected = selected.includes(opt.value)
						return (
							<Badge
								key={opt.value}
								variant={isSelected ? "default" : "outline"}
								className={`cursor-pointer select-none ${isSelected ? "" : "opacity-60 hover:opacity-100"}`}
								onClick={() => !disabled && toggle(opt.value)}
							>
								{opt.label}
							</Badge>
						)
					})}
				</div>
			</div>
		)
	}

	if (field.type === "number") {
		return (
			<div className="space-y-2">
				<Label htmlFor={name} className="text-xs font-medium">
					{labelContent}
				</Label>
				<Input
					id={name}
					type="number"
					value={value === undefined || value === null ? "" : String(value)}
					onChange={(e) => {
						const v = e.target.value
						onChange(v === "" ? undefined : Number(v))
					}}
					placeholder={field.defaultValue !== undefined ? String(field.defaultValue) : undefined}
					disabled={disabled}
				/>
			</div>
		)
	}

	return (
		<div className="space-y-2">
			<Label htmlFor={name} className="text-xs font-medium">
				{labelContent}
			</Label>
			<Input
				id={name}
				type={field.secret ? "password" : "text"}
				value={String(value ?? "")}
				onChange={(e) => onChange(e.target.value)}
				placeholder={field.defaultValue !== undefined ? String(field.defaultValue) : undefined}
				disabled={disabled}
			/>
		</div>
	)
}

function buildInitialValues(
	fields: Record<string, ConfigFieldDef>,
	saved: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const values: Record<string, unknown> = {}
	for (const [name, field] of Object.entries(fields)) {
		if (saved && name in saved) {
			values[name] = saved[name]
		} else if (field.defaultValue !== undefined) {
			values[name] = field.defaultValue
		} else if (field.type === "multiselect") {
			values[name] = []
		} else {
			values[name] = field.type === "number" ? undefined : ""
		}
	}
	return values
}

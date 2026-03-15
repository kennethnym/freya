import { createContext, useContext } from "react"

export type ApiRequestMiddleware = (
	url: Parameters<typeof fetch>[0],
	init: RequestInit,
) => RequestInit

export class ApiClient {
	private readonly baseUrl: string
	private readonly middlewares: readonly ApiRequestMiddleware[]

	private publicRoutes = new Set<string>(["/login", "/signup"])

	static noop = new ApiClient({ baseUrl: "" })

	constructor({
		baseUrl,
		middlewares = [],
	}: {
		baseUrl: string
		middlewares?: ApiRequestMiddleware[]
	}) {
		this.baseUrl = baseUrl
		this.middlewares = middlewares
	}

	async request<T>(...[url, init]: Parameters<typeof fetch>): Promise<[Response, T]> {
		const finalInit = init
			? this.middlewares.reduce((prevInit, middleware) => middleware(url, prevInit), init)
			: undefined
		return fetch(url instanceof Request ? url : new URL(url, this.baseUrl), finalInit).then((res) =>
			Promise.all([Promise.resolve(res), res.json()]),
		)
	}
}

export const ApiClientContext = createContext(ApiClient.noop)
export function useApiClient() {
	return useContext(ApiClientContext)
}

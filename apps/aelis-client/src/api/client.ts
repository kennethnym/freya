import { createContext, useContext } from "react"

export type ApiRequestMiddleware = (
	url: Parameters<typeof fetch>[0],
	init: RequestInit,
) => RequestInit

export class ApiClient {
	private readonly baseUrl: string
	private readonly middlewares: readonly ApiRequestMiddleware[]

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

	async request<T>(...[url, init = {}]: Parameters<typeof fetch>): Promise<[Response, T]> {
		const finalInit = this.middlewares.reduce(
			(prevInit, middleware) => middleware(url, prevInit),
			init,
		)
		return fetch(this.baseUrl ? new URL(url.toString(), this.baseUrl) : url, finalInit).then((res) =>
			Promise.all([Promise.resolve(res), res.json()]),
		)
	}
}

export const ApiClientContext = createContext(ApiClient.noop)
export function useApiClient() {
	return useContext(ApiClientContext)
}

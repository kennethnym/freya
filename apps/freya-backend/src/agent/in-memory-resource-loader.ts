import { createExtensionRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent"

export class InMemoryResourceLoader implements ResourceLoader {
	private readonly extensions: ReturnType<ResourceLoader["getExtensions"]> = {
		extensions: [],
		errors: [],
		runtime: createExtensionRuntime(),
	}

	constructor(private readonly systemPrompt: string) {}

	getExtensions(): ReturnType<ResourceLoader["getExtensions"]> {
		return this.extensions
	}

	getSkills(): ReturnType<ResourceLoader["getSkills"]> {
		return { skills: [], diagnostics: [] }
	}

	getPrompts(): ReturnType<ResourceLoader["getPrompts"]> {
		return { prompts: [], diagnostics: [] }
	}

	getThemes(): ReturnType<ResourceLoader["getThemes"]> {
		return { themes: [], diagnostics: [] }
	}

	getAgentsFiles(): ReturnType<ResourceLoader["getAgentsFiles"]> {
		return { agentsFiles: [] }
	}

	getSystemPrompt(): string {
		return this.systemPrompt
	}

	getAppendSystemPrompt(): string[] {
		return []
	}

	extendResources(_paths: Parameters<ResourceLoader["extendResources"]>[0]): void {}

	async reload(_options?: Parameters<ResourceLoader["reload"]>[0]): Promise<void> {}
}

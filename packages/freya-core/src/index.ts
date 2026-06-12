// Context
export type { ContextEntry, ContextKey, ContextKeyPart } from "./context"
export { Context, contextKey, serializeKey } from "./context"

// Actions
export type { ActionDefinition } from "./action"
export { UnknownActionError } from "./action"

// Feed
export type { FeedItem, FeedItemRenderer, FeedItemSignals, RenderedFeedItem, Slot } from "./feed"
export { TimeRelevance } from "./feed"

// Feed Source
export type { FeedSource } from "./feed-source"

// Feed Post-Processor
export type { FeedEnhancement, FeedPostProcessor, ItemGroup } from "./feed-post-processor"

// Feed Engine
export type { FeedEngineConfig, FeedResult, FeedSubscriber, SourceError } from "./feed-engine"
export { FeedEngine } from "./feed-engine"

// =============================================================================
// DEPRECATED - Use FeedSource + FeedEngine instead
// =============================================================================

// Data Source (deprecated - use FeedSource)
export type { DataSource } from "./data-source"

// Context Provider (deprecated - use FeedSource)
export type { ContextProvider } from "./context-provider"

// Context Bridge (deprecated - use FeedEngine)
export type { ProviderError, RefreshResult } from "./context-bridge"
export { ContextBridge } from "./context-bridge"

// Reconciler (deprecated - use FeedEngine)
export type {
	ReconcileResult,
	ReconcilerConfig,
	SourceError as ReconcilerSourceError,
} from "./reconciler"
export { Reconciler } from "./reconciler"

// Feed Controller (deprecated - use FeedEngine)
export type {
	FeedControllerConfig,
	FeedSubscriber as FeedControllerSubscriber,
} from "./feed-controller"
export { FeedController } from "./feed-controller"

import type { ChatEntrySummary, CommunityEventSummary, RedemptionSummary, RewardEventSummary } from './chat-context'

/** Optional controls for sending a chat message. */
export interface ChatSendOptions {
  replyParentMessageId?: string
  replyTo?: string
  simulated?: boolean
}

/** Result returned after a real or simulated chat send. */
export interface ChatSendResult {
  dropReasonCode?: string
  dropReasonMessage?: string
  id: string
  isSent: boolean
  simulated?: boolean
}

/** Serializable Twitch chat lifecycle and automation status. */
export interface ChatStatus {
  authMode: string | null
  automaticRedemptionHandlerCount: number
  botUserId: string | null
  botUserName: string | null
  broadcasterAuthUserId: string | null
  broadcasterId: string | null
  broadcasterName: string | null
  broadcasterTokenFile: string
  chatEntryCount: number
  chatEntryHandlerCount: number
  commandCount: number
  commandsLastError: string | null
  commandsLoadedAt: string | null
  commandsPath: string
  commandsRestartRequiredMessage: string | null
  communityEventCount: number
  communityEventHandlerCount: number
  connected: boolean
  enabled: boolean
  followHandlerCount: number
  lastChatEntry: ChatEntrySummary | null
  lastChatEntryAt: string | null
  lastChatEntryMatchedHandlers: number
  lastCommandAt: string | null
  lastCommunityEvent: CommunityEventSummary | null
  lastCommunityEventAt: string | null
  lastCommunityEventMatchedHandlers: number
  lastError: string | null
  lastMessageAt: string | null
  lastRedemption: RedemptionSummary | null
  lastRedemptionAt: string | null
  lastRedemptionMatchedHandlers: number
  lastRewardEvent: RewardEventSummary | null
  lastRewardEventAt: string | null
  lastRewardEventMatchedHandlers: number
  listenerActive: boolean
  messageCount: number
  nextRetryAt: string | null
  raidHandlerCount: number
  redemptionCount: number
  redemptionHandlerCount: number
  redemptionUpdateHandlerCount: number
  rewardEventCount: number
  rewardEventHandlerCount: number
  rewardsDisabledMessage: string | null
  rewardsEnabled: boolean
  rewardsLastError: string | null
  rewardsNextRetryAt: string | null
  rewardsRetryAttempt: number
  retryAttempt: number
  simulating: boolean
  started: boolean
  subscriptionHandlerCount: number
  tokenFile: string
}

/** Public API returned by the Twitch chat service factory. */
export interface ChatService {
  getStatus(): ChatStatus
  say(message: string, options?: ChatSendOptions): Promise<ChatSendResult>
  simulateEvent(type: string, event: Record<string, unknown>): Promise<void>
  start(): Promise<void>
  stop(): void
}

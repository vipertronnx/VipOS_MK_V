/** Identity fields shared by normalized Twitch automation contexts. */
export interface TwitchIdentityContext {
  broadcaster: string | undefined
  broadcasterDisplayName: string | undefined
  broadcasterId: string | undefined
  displayName: string | undefined
  message: string | undefined
  source: string
  user: string | undefined
  userId: string | null | undefined
  username: string | undefined
}

/** A normalized Twitch context associated with a named event. */
export interface TwitchContext extends TwitchIdentityContext {
  event: string
}

export interface MessageContext extends TwitchIdentityContext {
  after: string
  args: string[]
  badges: Record<string, unknown>
  chat: {
    badges: Record<string, unknown>
    broadcaster: { displayName: string | undefined, id: string | undefined, name: string | undefined }
    chatter: { color: string | undefined, displayName: string | undefined, id: string | undefined, name: string | undefined }
    isCheer: boolean | undefined
    isRedemption: boolean | undefined
    messageId: string | undefined
    messageType: string | undefined
    rewardId: string | undefined
    roles: string[]
    text: string | undefined
  }
  command: string
  commandName: string
  messageId: string | undefined
  roles: string[]
}

export interface ChatEntryContext extends MessageContext {
  chat: MessageContext['chat'] & { entryRoles: string[], role: string }
  entry: { firstSeenAt: string, roles: string[], role: string }
  event: 'chat.entry'
  source: 'chat-entry'
}

export interface RewardDetails {
  cost: number | undefined
  id: string | undefined
  prompt: string | undefined
  title: string | undefined
  [property: string]: unknown
}

export interface RedemptionContext extends TwitchContext {
  input: string
  redemption: { id: string | undefined, input: string, redeemedAt: string | null, rewardId?: string | undefined, rewardType?: string | undefined, status: string | undefined }
  reward: RewardDetails
}

export interface AutomaticRedemptionContext extends RedemptionContext {
  automaticReward: { channelPoints: number | undefined, emote: string | undefined, type: string | undefined }
  source: 'automatic-redemption'
}

export interface RewardEventContext extends TwitchContext {
  reward: RewardDetails
  source: 'reward'
}

export interface FollowContext extends TwitchContext {
  follow: { followedAt: string | null, userDisplayName: string | undefined, userId: string | undefined, username: string | undefined }
  source: 'follow'
}

export interface RaidContext extends TwitchContext {
  raid: {
    fromBroadcasterDisplayName: string | undefined
    fromBroadcasterId: string | undefined
    fromBroadcasterName: string | undefined
    toBroadcasterDisplayName: string | undefined
    toBroadcasterId: string | undefined
    toBroadcasterName: string | undefined
    viewers: number | undefined
  }
  source: 'raid'
  viewers: number | undefined
}

export interface SubscriptionContext extends TwitchContext {
  isGift: boolean
  subscription: Record<string, unknown>
  tier: string | undefined
  source: 'subscription'
}

export interface SubscriptionGiftContext extends TwitchContext {
  isAnonymous: boolean
  isGift: true
  subscription: Record<string, unknown>
  tier: string | undefined
  source: 'subscription'
}

export interface RedemptionSummary {
  automaticReward: AutomaticRedemptionContext['automaticReward'] | null
  displayName: string | undefined
  event: string
  input: string
  redeemedAt: string | null | undefined
  redemptionId: string | undefined
  reward: RewardDetails
  status: string | undefined
  user: string | undefined
  userId: string | null | undefined
}

export interface RewardEventSummary {
  event: string
  reward: RewardDetails
}

export interface CommunityEventSummary {
  displayName: string | undefined
  event: string
  follow: FollowContext['follow'] | null
  raid: RaidContext['raid'] | null
  subscription: Record<string, unknown> | null
  user: string | undefined
  userId: string | null | undefined
}

export interface ChatEntrySummary {
  displayName: string | undefined
  event: 'chat.entry'
  roles: string[]
  user: string | undefined
  userId: string | null | undefined
}

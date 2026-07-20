// Pure Twitch event context mapping and dashboard summaries.
/** @typedef {import('../../types/chat-context').AutomaticRedemptionContext} AutomaticRedemptionContext */
/** @typedef {import('../../types/chat-context').ChatEntryContext} ChatEntryContext */
/** @typedef {import('../../types/chat-context').ChatEntrySummary} ChatEntrySummary */
/** @typedef {import('../../types/chat-context').CommunityEventSummary} CommunityEventSummary */
/** @typedef {import('../../types/chat-context').FollowContext} FollowContext */
/** @typedef {import('../../types/chat-context').MessageContext} MessageContext */
/** @typedef {import('../../types/chat-context').RaidContext} RaidContext */
/** @typedef {import('../../types/chat-context').RedemptionContext} RedemptionContext */
/** @typedef {import('../../types/chat-context').RedemptionSummary} RedemptionSummary */
/** @typedef {import('../../types/chat-context').RewardEventContext} RewardEventContext */
/** @typedef {import('../../types/chat-context').RewardEventSummary} RewardEventSummary */
/** @typedef {import('../../types/chat-context').SubscriptionContext} SubscriptionContext */
/** @typedef {import('../../types/chat-context').SubscriptionGiftContext} SubscriptionGiftContext */
/**
 * Maps an incoming Twitch chat message into the shared automation context shape.
 *
 * @param {object} event Twurple chat event.
 * @param {object} state Chat service state containing the broadcaster identifier.
 * @returns {MessageContext} Context with chat metadata, normalized roles, and message fields.
 */
function createMessageContext(event, state) {
  const badges = event.badges || {}
  const roles = getRoles({
    badges,
    broadcasterId: state.broadcasterId,
    chatterId: event.chatterId
  })

  return {
    after: '',
    args: [],
    badges,
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    chat: {
      badges,
      broadcaster: {
        displayName: event.broadcasterDisplayName,
        id: event.broadcasterId,
        name: event.broadcasterName
      },
      chatter: {
        color: event.color,
        displayName: event.chatterDisplayName,
        id: event.chatterId,
        name: event.chatterName
      },
      isCheer: event.isCheer,
      isRedemption: event.isRedemption,
      messageId: event.messageId,
      messageType: event.messageType,
      rewardId: event.rewardId,
      roles,
      text: event.messageText
    },
    command: '',
    commandName: '',
    displayName: event.chatterDisplayName,
    message: event.messageText,
    messageId: event.messageId,
    roles,
    source: 'chat',
    user: event.chatterName,
    userId: event.chatterId,
    username: event.chatterName
  }
}

/**
 * Converts a chat message context into a chat-entry event and retains any moderator or VIP roles.
 *
 * @param {MessageContext} context Existing chat message context.
 * @returns {ChatEntryContext} Context augmented with entry timestamp and moderator/VIP roles.
 */
function createChatEntryContext(context) {
  const entryRoles = getPrivilegedEntryRoles(context.roles)
  const role = entryRoles[0] || ''

  return {
    ...context,
    chat: {
      ...context.chat,
      entryRoles,
      role
    },
    entry: {
      firstSeenAt: new Date().toISOString(),
      roles: entryRoles,
      role
    },
    event: 'chat.entry',
    message: `${context.displayName} entered chat`,
    source: 'chat-entry'
  }
}

/**
 * Maps a custom channel-point redemption event into an automation context.
 *
 * @param {string} eventName Canonical redemption event name.
 * @param {object} event Twurple redemption event.
 * @returns {RedemptionContext} Context containing redemption, reward, user, and input details.
 */
function createRedemptionContext(eventName, event) {
  const input = event.input || ''
  const redeemedAt = dateToIso(event.redemptionDate)

  return {
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    displayName: event.userDisplayName,
    event: eventName,
    input,
    message: input,
    redemption: {
      id: event.id,
      input,
      redeemedAt,
      rewardId: event.rewardId,
      status: event.status
    },
    reward: {
      cost: event.rewardCost,
      id: event.rewardId,
      prompt: event.rewardPrompt,
      title: event.rewardTitle
    },
    source: 'redemption',
    user: event.userName,
    userId: event.userId,
    username: event.userName
  }
}

/**
 * Maps a Twitch automatic reward redemption into an automation context.
 *
 * @param {object} event Twurple automatic-redemption event.
 * @returns {AutomaticRedemptionContext} Context with fulfilled redemption status and automatic reward details.
 */
function createAutomaticRedemptionContext(event) {
  const reward = event.reward
  const message = event.messageText || ''
  const redeemedAt = dateToIso(event.redemptionDate)

  return {
    automaticReward: {
      channelPoints: reward.channelPoints,
      emote: reward.emote,
      type: reward.type
    },
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    displayName: event.userDisplayName,
    event: 'automatic-redemption.add',
    input: message,
    message,
    redemption: {
      id: event.id,
      input: message,
      redeemedAt,
      rewardType: reward.type,
      status: 'fulfilled'
    },
    reward: {
      cost: reward.channelPoints,
      id: reward.type,
      prompt: '',
      title: reward.type,
      type: reward.type
    },
    source: 'automatic-redemption',
    user: event.userName,
    userId: event.userId,
    username: event.userName
  }
}

/**
 * Maps a channel-point reward lifecycle event into an automation context.
 *
 * @param {string} eventName Canonical reward event name.
 * @param {object} event Twurple reward event.
 * @returns {RewardEventContext} Context containing the reward settings supplied by Twitch.
 */
function createRewardEventContext(eventName, event) {
  return {
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    displayName: event.broadcasterDisplayName,
    event: eventName,
    message: event.title,
    reward: {
      autoApproved: event.autoApproved,
      backgroundColor: event.backgroundColor,
      cost: event.cost,
      globalCooldown: event.globalCooldown,
      id: event.id,
      isEnabled: event.isEnabled,
      isInStock: event.isInStock,
      isPaused: event.isPaused,
      maxRedemptionsPerStream: event.maxRedemptionsPerStream,
      maxRedemptionsPerUserPerStream: event.maxRedemptionsPerUserPerStream,
      prompt: event.prompt,
      redemptionsThisStream: event.redemptionsThisStream,
      title: event.title,
      userInputRequired: event.userInputRequired
    },
    source: 'reward',
    user: event.broadcasterName,
    userId: event.broadcasterId,
    username: event.broadcasterName
  }
}

/**
 * Maps a Twitch follow event into an automation context.
 *
 * @param {object} event Twurple follow event.
 * @returns {FollowContext} Context containing follower identity and ISO-formatted follow time when valid.
 */
function createFollowContext(event) {
  const followedAt = dateToIso(event.followDate)

  return {
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    displayName: event.userDisplayName,
    event: 'follow.add',
    follow: {
      followedAt,
      userDisplayName: event.userDisplayName,
      userId: event.userId,
      username: event.userName
    },
    message: `${event.userDisplayName} followed`,
    source: 'follow',
    user: event.userName,
    userId: event.userId,
    username: event.userName
  }
}

/**
 * Maps a Twitch raid event into an automation context.
 *
 * @param {object} event Twurple raid event.
 * @returns {RaidContext} Context containing raid source, target, and viewer count.
 */
function createRaidContext(event) {
  return {
    broadcaster: event.raidedBroadcasterName,
    broadcasterDisplayName: event.raidedBroadcasterDisplayName,
    broadcasterId: event.raidedBroadcasterId,
    displayName: event.raidingBroadcasterDisplayName,
    event: 'raid.add',
    message: `${event.raidingBroadcasterDisplayName} raided with ${event.viewers} viewers`,
    raid: {
      fromBroadcasterDisplayName: event.raidingBroadcasterDisplayName,
      fromBroadcasterId: event.raidingBroadcasterId,
      fromBroadcasterName: event.raidingBroadcasterName,
      toBroadcasterDisplayName: event.raidedBroadcasterDisplayName,
      toBroadcasterId: event.raidedBroadcasterId,
      toBroadcasterName: event.raidedBroadcasterName,
      viewers: event.viewers
    },
    source: 'raid',
    user: event.raidingBroadcasterName,
    userId: event.raidingBroadcasterId,
    username: event.raidingBroadcasterName,
    viewers: event.viewers
  }
}

/**
 * Maps a Twitch subscription event into an automation context.
 *
 * @param {object} event Twurple subscription event.
 * @returns {SubscriptionContext} Context containing subscriber identity, tier, and gift flag.
 */
function createSubscriptionContext(event) {
  return {
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    displayName: event.userDisplayName,
    event: 'subscription.add',
    isGift: Boolean(event.isGift),
    message: `${event.userDisplayName} subscribed`,
    source: 'subscription',
    subscription: {
      isGift: Boolean(event.isGift),
      tier: event.tier,
      userDisplayName: event.userDisplayName,
      userId: event.userId,
      username: event.userName
    },
    tier: event.tier,
    user: event.userName,
    userId: event.userId,
    username: event.userName
  }
}

/**
 * Maps a Twitch subscription-gift event into an automation context, using anonymous top-level user identity when required.
 *
 * @param {object} event Twurple subscription-gift event.
 * @returns {SubscriptionGiftContext} Context containing gift details and an anonymous placeholder when required.
 */
function createSubscriptionGiftContext(event) {
  const displayName = event.isAnonymous ? 'Anonymous' : event.gifterDisplayName
  const username = event.isAnonymous ? 'anonymous' : event.gifterName
  const userId = event.isAnonymous ? null : event.gifterId

  return {
    broadcaster: event.broadcasterName,
    broadcasterDisplayName: event.broadcasterDisplayName,
    broadcasterId: event.broadcasterId,
    displayName,
    event: 'subscription.gift',
    isAnonymous: Boolean(event.isAnonymous),
    isGift: true,
    message: `${displayName} gifted ${event.amount} subscription${Number(event.amount) === 1 ? '' : 's'}`,
    source: 'subscription',
    subscription: {
      amount: event.amount,
      cumulativeAmount: event.cumulativeAmount,
      gifterDisplayName: event.gifterDisplayName,
      gifterId: event.gifterId,
      gifterName: event.gifterName,
      isAnonymous: Boolean(event.isAnonymous),
      isGift: true,
      tier: event.tier
    },
    tier: event.tier,
    user: username,
    userId,
    username
  }
}

/**
 * Selects redemption fields used by dashboard event summaries.
 *
 * @param {RedemptionContext|AutomaticRedemptionContext} context Redemption automation context.
 * @returns {RedemptionSummary} Compact redemption summary.
 */
function summarizeRedemptionContext(context) {
  return {
    automaticReward: context.automaticReward || null,
    displayName: context.displayName,
    event: context.event,
    input: context.input || '',
    redeemedAt: context.redemption && context.redemption.redeemedAt,
    redemptionId: context.redemption && context.redemption.id,
    reward: context.reward,
    status: context.redemption && context.redemption.status,
    user: context.user,
    userId: context.userId
  }
}

/**
 * Selects reward lifecycle fields for a dashboard event summary.
 *
 * @param {RewardEventContext} context Reward automation context.
 * @returns {RewardEventSummary} Event name and reward details.
 */
function summarizeRewardEventContext(context) {
  return {
    event: context.event,
    reward: context.reward
  }
}

/**
 * Selects follow, raid, or subscription fields for a dashboard event summary.
 *
 * @param {FollowContext|RaidContext|SubscriptionContext|SubscriptionGiftContext} context Community-event automation context.
 * @returns {CommunityEventSummary} Compact user and event-specific summary.
 */
function summarizeCommunityEventContext(context) {
  return {
    displayName: context.displayName,
    event: context.event,
    follow: context.follow || null,
    raid: context.raid || null,
    subscription: context.subscription || null,
    user: context.user,
    userId: context.userId
  }
}

/**
 * Selects chat-entry identity and privileged-role fields for the dashboard.
 *
 * @param {ChatEntryContext} context Chat-entry automation context.
 * @returns {ChatEntrySummary} Compact entry summary.
 */
function summarizeChatEntryContext(context) {
  return {
    displayName: context.displayName,
    event: context.event,
    roles: context.entry.roles,
    user: context.user,
    userId: context.userId
  }
}

/**
 * Extracts the moderator and VIP roles that qualify a chatter for entry automation.
 *
 * @param {string[]} roles Raw or normalized role names.
 * @returns {string[]} Present privileged roles in moderator-then-VIP order.
 */
function getPrivilegedEntryRoles(roles) {
  const actual = new Set((roles || []).map(normalizeRole))
  return ['moderator', 'vip'].filter(role => actual.has(role))
}

function getRoles({ badges, broadcasterId, chatterId }) {
  const roles = new Set(['everyone'])

  if (chatterId === broadcasterId || badges.broadcaster) roles.add('broadcaster')
  if (badges.moderator) roles.add('moderator')
  if (badges.vip) roles.add('vip')
  if (badges.subscriber) roles.add('subscriber')
  if (badges.founder) {
    roles.add('founder')
    roles.add('subscriber')
  }

  return [...roles]
}

/**
 * Normalizes role aliases used by command configuration and chat badges.
 *
 * @param {*} role Role name or alias such as `mod`, `sub`, `all`, or `*`.
 * @returns {string} Canonical alias when recognized, otherwise the trimmed lower-case role name.
 */
function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  const aliases = {
    '*': 'everyone',
    all: 'everyone',
    mod: 'moderator',
    mods: 'moderator',
    sub: 'subscriber',
    subs: 'subscriber',
    vips: 'vip'
  }

  return aliases[normalized] || normalized
}

function dateToIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

module.exports = {
  createAutomaticRedemptionContext,
  createChatEntryContext,
  createFollowContext,
  createMessageContext,
  createRaidContext,
  createRedemptionContext,
  createRewardEventContext,
  createSubscriptionContext,
  createSubscriptionGiftContext,
  getPrivilegedEntryRoles,
  normalizeRole,
  summarizeChatEntryContext,
  summarizeCommunityEventContext,
  summarizeRedemptionContext,
  summarizeRewardEventContext
}

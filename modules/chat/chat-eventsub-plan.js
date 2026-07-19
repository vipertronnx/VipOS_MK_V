const EVENT_SUB_HANDLER_GROUPS = Object.freeze({
  automaticRedemptions: 'automatic redemptions',
  follows: 'follows',
  raids: 'raids',
  redemptions: 'redemptions',
  redemptionUpdates: 'redemption updates',
  rewardAddEvents: 'reward add events',
  rewardRemoveEvents: 'reward remove events',
  rewardUpdateEvents: 'reward update events',
  subscriptions: 'subscriptions'
})

function getConfiguredEventSubHandlerGroupsFromSnapshot({
  automaticRedemptionHandlers = [],
  followHandlers = [],
  raidHandlers = [],
  redemptionHandlers = [],
  redemptionUpdateHandlers = [],
  rewardEventHandlers = [],
  subscriptionHandlers = []
} = {}) {
  return getConfiguredEventSubHandlerGroups({
    automaticRedemptionHandlerCount: automaticRedemptionHandlers.length,
    followHandlerCount: followHandlers.length,
    raidHandlerCount: raidHandlers.length,
    redemptionHandlerCount: redemptionHandlers.length,
    redemptionUpdateHandlerCount: redemptionUpdateHandlers.length,
    rewardAddEventHandlerCount: hasRewardEventHandler(rewardEventHandlers, 'reward.add'),
    rewardRemoveEventHandlerCount: hasRewardEventHandler(rewardEventHandlers, 'reward.remove'),
    rewardUpdateEventHandlerCount: hasRewardEventHandler(rewardEventHandlers, 'reward.update'),
    subscriptionHandlerCount: subscriptionHandlers.length
  })
}

function hasRewardEventHandler(handlers, eventName) {
  return handlers.some(handler => !handler.events.length || handler.events.includes(eventName))
}

function getConfiguredEventSubHandlerGroups({
  automaticRedemptionHandlerCount = 0,
  followHandlerCount = 0,
  raidHandlerCount = 0,
  redemptionHandlerCount = 0,
  redemptionUpdateHandlerCount = 0,
  rewardAddEventHandlerCount = 0,
  rewardRemoveEventHandlerCount = 0,
  rewardUpdateEventHandlerCount = 0,
  subscriptionHandlerCount = 0
} = {}) {
  return new Set([
    followHandlerCount ? EVENT_SUB_HANDLER_GROUPS.follows : '',
    raidHandlerCount ? EVENT_SUB_HANDLER_GROUPS.raids : '',
    subscriptionHandlerCount ? EVENT_SUB_HANDLER_GROUPS.subscriptions : '',
    redemptionHandlerCount ? EVENT_SUB_HANDLER_GROUPS.redemptions : '',
    redemptionUpdateHandlerCount ? EVENT_SUB_HANDLER_GROUPS.redemptionUpdates : '',
    automaticRedemptionHandlerCount ? EVENT_SUB_HANDLER_GROUPS.automaticRedemptions : '',
    rewardAddEventHandlerCount ? EVENT_SUB_HANDLER_GROUPS.rewardAddEvents : '',
    rewardUpdateEventHandlerCount ? EVENT_SUB_HANDLER_GROUPS.rewardUpdateEvents : '',
    rewardRemoveEventHandlerCount ? EVENT_SUB_HANDLER_GROUPS.rewardRemoveEvents : ''
  ].filter(Boolean))
}

function getUnsubscribedEventSubHandlerGroups(configuredGroups, subscribedGroups) {
  return [...configuredGroups].filter(group => !subscribedGroups.has(group))
}

function getEventSubAuthRequirements({
  config = {},
  followHandlers = [],
  subscriptionHandlers = []
} = {}) {
  return {
    needsBroadcasterToken: Boolean(config.enableRedemptions) || followHandlers.length > 0 || subscriptionHandlers.length > 0,
    needsFollowScopes: followHandlers.length > 0,
    needsSubscriptionScopes: subscriptionHandlers.length > 0
  }
}

module.exports = {
  EVENT_SUB_HANDLER_GROUPS,
  getConfiguredEventSubHandlerGroups,
  getConfiguredEventSubHandlerGroupsFromSnapshot,
  getEventSubAuthRequirements,
  getUnsubscribedEventSubHandlerGroups
}

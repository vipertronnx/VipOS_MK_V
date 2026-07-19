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

/**
 * Derives the EventSub subscription categories required by a normalized command configuration snapshot.
 *
 * @param {object} [snapshot] Handler arrays grouped by event type.
 * @returns {Set<string>} Human-readable EventSub groups that have at least one applicable handler.
 */
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

/**
 * Derives EventSub subscription categories from handler counts.
 *
 * @param {object} [counts] Number of configured handlers for each supported EventSub category.
 * @returns {Set<string>} Human-readable groups with a non-zero handler count.
 */
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

/**
 * Finds configured EventSub groups absent from the current listener subscriptions.
 *
 * @param {Set<string>} configuredGroups Required subscription groups.
 * @param {Set<string>} subscribedGroups Groups already registered on the listener.
 * @returns {string[]} Required groups that remain unsubscribed.
 */
function getUnsubscribedEventSubHandlerGroups(configuredGroups, subscribedGroups) {
  return [...configuredGroups].filter(group => !subscribedGroups.has(group))
}

/**
 * Determines whether the configured EventSub handlers require broadcaster credentials and specific scopes.
 *
 * @param {object} [options] EventSub configuration and normalized handler arrays.
 * @returns {{needsBroadcasterToken: boolean, needsFollowScopes: boolean, needsSubscriptionScopes: boolean}} Required auth capabilities.
 */
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

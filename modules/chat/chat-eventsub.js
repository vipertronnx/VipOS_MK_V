const { createRetryScheduler } = require('./chat-retry')

/**
 * Creates an EventSub WebSocket lifecycle that retries failed reward subscriptions independently.
 *
 * @param {object} options EventSub configuration and lifecycle callbacks.
 * @param {object} options.config Retry interval configuration.
 * @returns {object} Listener start/stop operations and current subscription-state accessors.
 */
function createEventSubLifecycle({
  config,
  logger = console,
  updateState = () => {},
  isEnabled = () => true,
  shouldRun = () => true,
  onRestart = () => {}
} = {}) {
  let listener = null
  let subscribedGroups = new Set()
  let rewardSubscriptionRegistrars = new Map()
  let rewardSubscriptionRetryQueue = new Map()

  const rewardRetry = createRetryScheduler({
    initialMs: config.reconnectInitialMs,
    maxMs: config.reconnectMaxMs,
    onSchedule({ attempt, delay }) {
      updateState({
        rewardsNextRetryAt: new Date(Date.now() + delay).toISOString(),
        rewardsRetryAttempt: attempt
      })
      logger.warn(`Retrying Twitch reward subscription in ${Math.round(delay / 1000)}s`)
    },
    onRetry: retryRewardSubscriptions,
    onReset() {
      updateState({
        rewardsNextRetryAt: null,
        rewardsRetryAttempt: 0
      })
    }
  })

  /**
   * Registers configured subscriptions and starts a newly constructed EventSub listener.
   *
   * @param {object} options Listener constructor, API client, authentication IDs, and registration callbacks.
   * @param {Array<object>} [options.registrations=[]] Subscription registrations to attach before starting.
   * @returns {void}
   * @throws {Error} Throws when listener construction, registration, or startup fails synchronously.
   */
  function start({
    apiClient,
    EventSubWsListener,
    botUserId,
    broadcasterAuthUserId,
    registrations = []
  } = {}) {
    listener = new EventSubWsListener({ apiClient })
    bindListenerEvents(listener, { botUserId, broadcasterAuthUserId })
    const nextSubscribedGroups = new Set()

    for (const registration of registrations) {
      const subscription = registration.register(listener)
      if (isRewardSubscription(subscription)) trackRewardSubscription(subscription, registration.register)
      if (registration.group) nextSubscribedGroups.add(registration.group)
    }

    subscribedGroups = nextSubscribedGroups
    listener.start()
  }

  function stop() {
    if (listener) listener.stop()
    listener = null
    updateState({ connected: false })
    rewardRetry.reset()
    rewardSubscriptionRegistrars = new Map()
    rewardSubscriptionRetryQueue = new Map()
  }

  function isActive() {
    return Boolean(listener && listener.isActive)
  }

  function getSubscribedGroups() {
    return new Set(subscribedGroups)
  }

  function bindListenerEvents(eventSubListener, { botUserId, broadcasterAuthUserId }) {
    eventSubListener.onUserSocketConnect(userId => {
      if (userId === botUserId) {
        updateState({ connected: true })
        logger.log('Twitch EventSub socket connected')
      }
    })

    eventSubListener.onUserSocketDisconnect((userId, error) => {
      if (userId === botUserId) {
        updateState({
          connected: false,
          ...(error ? { lastError: error.message } : {})
        })
        logger.warn(`Twitch EventSub socket disconnected${error ? `: ${error.message}` : ''}`)
      } else if (userId === broadcasterAuthUserId) {
        updateState(error ? { rewardsLastError: error.message } : {})
        logger.warn(`Twitch reward EventSub socket disconnected${error ? `: ${error.message}` : ''}`)
      }
    })

    eventSubListener.onSubscriptionCreateFailure((subscription, error) => {
      if (isRewardSubscription(subscription)) {
        updateState({ rewardsLastError: error.message })
        logger.error(`Twitch reward subscription failed (${subscription.id}): ${error.message}`)
        scheduleRewardSubscriptionRetry(subscription)
        return
      }

      updateState({ lastError: error.message })
      logger.error(`Twitch EventSub subscription failed (${subscription.id}): ${error.message}`)
      onRestart()
    })

    eventSubListener.onSubscriptionCreateSuccess(subscription => {
      if (!isRewardSubscription(subscription)) return

      rewardSubscriptionRetryQueue.delete(subscription.id)
      updateState({ rewardsLastError: null })
      if (!rewardSubscriptionRetryQueue.size && !rewardRetry.isScheduled()) {
        rewardRetry.reset()
      }
    })

    eventSubListener.onRevoke(subscription => {
      if (isRewardSubscription(subscription)) {
        updateState({ rewardsLastError: `Subscription revoked: ${subscription.id}` })
        logger.warn(`Twitch reward subscription revoked: ${subscription.id}`)
        scheduleRewardSubscriptionRetry(subscription)
        return
      }

      updateState({ lastError: `Subscription revoked: ${subscription.id}` })
      logger.warn(`Twitch EventSub subscription revoked: ${subscription.id}`)
      onRestart()
    })
  }

  function trackRewardSubscription(subscription, register) {
    rewardSubscriptionRegistrars.set(subscription.id, register)
  }

  function scheduleRewardSubscriptionRetry(subscription) {
    if (!isEnabled() || !shouldRun() || !isActive()) return

    const register = rewardSubscriptionRegistrars.get(subscription.id)
    if (!register) return

    rewardSubscriptionRetryQueue.set(subscription.id, register)
    rewardRetry.schedule()
  }

  function retryRewardSubscriptions() {
    if (!shouldRun() || !isActive()) return

    const registrations = [...rewardSubscriptionRetryQueue.values()]
    rewardSubscriptionRetryQueue.clear()
    updateState({ rewardsNextRetryAt: null })

    for (const register of registrations) {
      try {
        trackRewardSubscription(register(listener), register)
      } catch (error) {
        updateState({ rewardsLastError: error.message })
        logger.error(`Twitch reward subscription retry failed: ${error.message}`)
      }
    }
  }

  return {
    getSubscribedGroups,
    isActive,
    start,
    stop
  }
}

function isRewardSubscription(subscription) {
  return String((subscription && subscription.id) || '').startsWith('channel.channel_points_')
}

module.exports = {
  createEventSubLifecycle
}

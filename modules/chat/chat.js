const path = require('path')
const {
  CHAT_SCOPES,
  ChatConfigError,
  createAuthProvider,
  FOLLOW_SCOPES,
  isNonRetryableStartupError,
  readAuthConfig,
  readTokenConfig,
  REDEMPTION_SCOPES,
  SUBSCRIPTION_SCOPES,
  TokenConfigError
} = require('./chat-auth')
const { relativeAppPath, resolveAppPath } = require('../utils/app-path')
const { parseBool } = require('../utils/value-normalization')
const {
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
  summarizeChatEntryContext,
  summarizeCommunityEventContext,
  summarizeRedemptionContext,
  summarizeRewardEventContext
} = require('./chat-context')
const {
  normalizeEventName
} = require('./chat-normalization')
const { createChatAutomation } = require('./chat-automation')
const { createCommandConfigLifecycle } = require('./chat-command-config')
const { createEventSubLifecycle } = require('./chat-eventsub')
const {
  EVENT_SUB_HANDLER_GROUPS,
  getConfiguredEventSubHandlerGroups,
  getConfiguredEventSubHandlerGroupsFromSnapshot,
  getEventSubAuthRequirements,
  getUnsubscribedEventSubHandlerGroups
} = require('./chat-eventsub-plan')
const { createRetryScheduler } = require('./chat-retry')

/** @typedef {import('../../types/chat').ChatSendOptions} ChatSendOptions */
/** @typedef {import('../../types/chat').ChatSendResult} ChatSendResult */
/** @typedef {import('../../types/chat').ChatService} ChatService */
/** @typedef {import('../../types/chat').ChatStatus} ChatStatus */

const DEFAULT_COMMAND_PREFIX = '!'
const DEFAULT_COMMANDS_FILE = path.join(__dirname, '..', '..', 'config', 'commands.json')
const DEFAULT_RECONNECT_INITIAL_MS = 5000
const DEFAULT_RECONNECT_MAX_MS = 60000
let twurpleModules = null

/**
 * Creates the Twitch chat and EventSub runtime, including command reloads and simulation support.
 *
 * @param {object} options Action services and optional runtime adapters.
 * @param {object} options.actions Action runner used by chat automation.
 * @param {object|null} [options.actionQueue] Queue used to serialize automation actions.
 * @param {object|null} [options.raffle] Raffle service allowed to consume chat commands first.
 * @returns {ChatService} Start/stop, status, chat-send, and supported-event simulation operations.
 */
function createChatService({ actions, actionQueue = null, commandConfigFileSystem, logger = console, onReady = null, raffle = null, twurpleLoader = loadTwurple } = {}) {
  if (!actions) throw new Error('Chat service requires an action runner')

  const config = readConfig()

  let api = null
  let authProvider = null
  let shouldRun = false
  let starting = false
  const seenChatEntrants = new Set()

  const state = {
    enabled: config.enabled,
    started: false,
    connected: false,
    authMode: null,
    botUserId: config.botUserId || null,
    botUserName: normalizeLogin(config.botUsername) || null,
    broadcasterAuthUserId: null,
    broadcasterId: config.broadcasterId || null,
    broadcasterName: normalizeLogin(config.broadcasterLogin) || null,
    broadcasterTokenFile: relativeAppPath(config.broadcasterTokenFile),
    commandCount: 0,
    commandsLoadedAt: null,
    commandsLastError: null,
    commandsPath: relativeAppPath(config.commandsFile),
    commandsRestartRequiredMessage: null,
    automaticRedemptionHandlerCount: 0,
    chatEntryCount: 0,
    chatEntryHandlerCount: 0,
    communityEventCount: 0,
    communityEventHandlerCount: 0,
    simulating: false,
    followHandlerCount: 0,
    lastCommandAt: null,
    lastChatEntry: null,
    lastChatEntryAt: null,
    lastChatEntryMatchedHandlers: 0,
    lastCommunityEvent: null,
    lastCommunityEventAt: null,
    lastCommunityEventMatchedHandlers: 0,
    lastError: null,
    lastMessageAt: null,
    lastRedemption: null,
    lastRedemptionAt: null,
    lastRedemptionMatchedHandlers: 0,
    lastRewardEvent: null,
    lastRewardEventAt: null,
    lastRewardEventMatchedHandlers: 0,
    messageCount: 0,
    nextRetryAt: null,
    raidHandlerCount: 0,
    redemptionCount: 0,
    redemptionHandlerCount: 0,
    redemptionUpdateHandlerCount: 0,
    rewardsEnabled: config.enableRedemptions,
    rewardsDisabledMessage: null,
    rewardsLastError: null,
    rewardsNextRetryAt: null,
    rewardEventCount: 0,
    rewardEventHandlerCount: 0,
    rewardsRetryAttempt: 0,
    subscriptionHandlerCount: 0,
    retryAttempt: 0,
    tokenFile: relativeAppPath(config.tokenFile)
  }

  const startupRetry = createRetryScheduler({
    initialMs: config.reconnectInitialMs,
    maxMs: config.reconnectMaxMs,
    onSchedule({ attempt, delay }) {
      state.retryAttempt = attempt
      state.nextRetryAt = new Date(Date.now() + delay).toISOString()
      logger.warn(`Retrying Twitch chat startup in ${Math.round(delay / 1000)}s`)
    },
    onRetry: start,
    onReset() {
      state.retryAttempt = 0
      state.nextRetryAt = null
    }
  })

  const eventSub = createEventSubLifecycle({
    config,
    isEnabled: () => state.enabled,
    logger,
    onRestart() {
      cleanupListener()
      scheduleRetry()
    },
    shouldRun: () => shouldRun,
    updateState(nextState) {
      Object.assign(state, nextState)
    }
  })

  const commandConfig = createCommandConfigLifecycle({
    commandPrefix: config.commandPrefix,
    commandsFile: config.commandsFile,
    fileSystem: commandConfigFileSystem,
    logger,
    onError(error) {
      state.commandsLastError = error.message
      logger.error(`Failed to load Twitch commands from ${relativeAppPath(config.commandsFile)}: ${error.message}`)
    },
    onLoaded(snapshot) {
      applyCommandConfig(snapshot, { loaded: true })
    },
    onMissing(snapshot) {
      applyCommandConfig(snapshot)
      logger.warn(`Twitch commands file not found: ${relativeAppPath(config.commandsFile)}`)
    },
    onReloadError(error) {
      state.lastError = error.message
      logger.error(`Failed to reload Twitch commands: ${error.message}`)
    }
  })

  const automation = createChatAutomation({
    actions,
    actionQueue,
    defaultAlertSound: config.defaultAlertSound,
    isSimulating: () => state.simulating,
    logger,
    onCommandAccepted() {
      state.lastCommandAt = new Date().toISOString()
    }
  })

  /**
   * Starts command loading, Twitch authentication, EventSub registration, and configuration watching.
   * Startup failures are recorded and may schedule a retry instead of rejecting the caller.
   *
   * @returns {Promise<void>} Resolves after startup work has completed or a handled startup failure has been recorded.
   */
  async function start() {
    shouldRun = true

    if (!state.enabled) {
      logger.warn('Twitch chat is disabled')
      return
    }

    if (state.started || starting) return
    starting = true

    try {
      await commandConfig.load()

      const twurple = await twurpleLoader()
      const currentCommandConfig = commandConfig.getSnapshot()
      const auth = await createAuthProvider(twurple, config, logger, getEventSubAuthRequirements({
        config,
        followHandlers: currentCommandConfig.followHandlers,
        subscriptionHandlers: currentCommandConfig.subscriptionHandlers
      }))
      authProvider = auth.authProvider
      state.authMode = auth.mode
      state.botUserId = auth.botUserId
      state.broadcasterAuthUserId = auth.broadcasterUserId || null

      api = new twurple.ApiClient({ authProvider })

      const broadcaster = await resolveBroadcaster(api, config)
      state.broadcasterId = broadcaster.id
      state.broadcasterName = broadcaster.name
      if (state.broadcasterAuthUserId && state.broadcasterAuthUserId !== state.broadcasterId) {
        throw new Error('TWITCH_BROADCASTER_REFRESH_TOKEN must belong to TWITCH_CHANNEL')
      }

      if (!state.botUserName) {
        const botUser = await api.users.getUserById(state.botUserId)
        state.botUserName = botUser ? botUser.name : state.botUserId
      }

      if (!shouldRun) return

      state.commandsRestartRequiredMessage = null
      eventSub.start({
        apiClient: api,
        EventSubWsListener: twurple.EventSubWsListener,
        botUserId: state.botUserId,
        broadcasterAuthUserId: state.broadcasterAuthUserId,
        registrations: getEventSubRegistrations()
      })
      if (!shouldRun) {
        cleanupListener()
        return
      }

      commandConfig.watch()
      state.started = true
      state.lastError = null
      startupRetry.reset()
      await notifyReady()
      logger.log(`Twitch chat listener starting for #${state.broadcasterName} as ${state.botUserName}`)
    } catch (error) {
      state.lastError = error.message
      logger.error(`Twitch chat failed to start: ${error.message}`)
      cleanupListener()
      if (!isNonRetryableStartupError(error)) {
        scheduleRetry()
      }
    } finally {
      starting = false
    }
  }

  /**
   * Stops retries, EventSub listening, and command-file watching.
   *
   * @returns {void}
   */
  function stop() {
    shouldRun = false
    startupRetry.reset()
    cleanupListener()
    commandConfig.unwatch()
  }

  function cleanupListener() {
    eventSub.stop()
    state.started = false
  }

  function scheduleRetry() {
    if (!state.enabled) return
    if (!shouldRun) return
    startupRetry.schedule()
  }

  async function notifyReady() {
    if (typeof onReady !== 'function') return

    try {
      await onReady()
    } catch (error) {
      logger.error(`Twitch chat ready handler failed: ${error.message}`)
    }
  }

  /**
   * Sends a chat message or records a simulated send while simulation is active.
   *
   * @param {string} message Non-empty message text to send.
   * @param {ChatSendOptions} [options] Optional simulation and reply-parent settings.
   * @returns {Promise<ChatSendResult>} Twitch send result or a simulated result with a generated ID.
   * @throws {Error} Rejects when chat is not ready, the message is empty, or Twitch fails to send it.
   */
  async function say(message, options = {}) {
    if (options.simulated || state.simulating) {
      const text = String(message || '').trim()
      if (!text) throw new Error('chat.say requires a message')
      logger.log(`Simulated Twitch chat message: ${text}`)
      return {
        id: `simulated-${Date.now()}`,
        isSent: true,
        simulated: true
      }
    }

    if (!api || !state.botUserId || !state.broadcasterId) {
      throw new Error('Twitch chat is not ready')
    }

    const text = String(message || '').trim()
    if (!text) throw new Error('chat.say requires a message')

    const params = {}
    const replyParentMessageId = options.replyParentMessageId || options.replyTo
    if (replyParentMessageId) params.replyParentMessageId = replyParentMessageId

    const sent = await api.asUser(state.botUserId, async ctx => (
      ctx.chat.sendChatMessage(state.broadcasterId, text, params)
    ))

    return {
      id: sent.id,
      isSent: sent.isSent,
      dropReasonCode: sent.dropReasonCode,
      dropReasonMessage: sent.dropReasonMessage
    }
  }

  function getEventSubRegistrations() {
    const commandConfigSnapshot = commandConfig.getSnapshot()
    const configuredGroups = getConfiguredEventSubHandlerGroupsFromSnapshot(commandConfigSnapshot)

    return [
      {
        register: eventSubListener => eventSubListener.onChannelChatMessage(
          state.broadcasterId,
          state.botUserId,
          createEventHandler(handleMessage, 'lastError', 'chat message')
        )
      },
      ...getRewardSubscriptionRegistrations(configuredGroups),
      ...getCommunitySubscriptionRegistrations(configuredGroups)
    ]
  }

  function getRewardSubscriptionRegistrations(configuredGroups) {
    const registrations = []

    if (!config.enableRedemptions) return registrations
    if (!state.broadcasterAuthUserId) {
      state.rewardsLastError = 'Broadcaster token is required for Twitch reward events'
      logger.warn(state.rewardsLastError)
      return registrations
    }

    registrations.push({
      group: EVENT_SUB_HANDLER_GROUPS.redemptions,
      register: eventSubListener => eventSubListener.onChannelRedemptionAdd(
        state.broadcasterId,
        createEventHandler(event => handleRedemption('redemption.add', event), 'rewardsLastError', 'redemption')
      )
    })

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.redemptionUpdates)) {
      registrations.push({
        group: EVENT_SUB_HANDLER_GROUPS.redemptionUpdates,
        register: eventSubListener => eventSubListener.onChannelRedemptionUpdate(
          state.broadcasterId,
          createEventHandler(event => handleRedemption('redemption.update', event), 'rewardsLastError', 'redemption update')
        )
      })
    }

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.automaticRedemptions)) {
      registrations.push({
        group: EVENT_SUB_HANDLER_GROUPS.automaticRedemptions,
        register: eventSubListener => eventSubListener.onChannelAutomaticRewardRedemptionAddV2(
          state.broadcasterId,
          createEventHandler(handleAutomaticRedemption, 'rewardsLastError', 'automatic redemption')
        )
      })
    }

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.rewardAddEvents)) {
      registrations.push({
        group: EVENT_SUB_HANDLER_GROUPS.rewardAddEvents,
        register: eventSubListener => eventSubListener.onChannelRewardAdd(
          state.broadcasterId,
          createEventHandler(event => handleRewardEvent('reward.add', event), 'rewardsLastError', 'reward add')
        )
      })
    }

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.rewardUpdateEvents)) {
      registrations.push({
        group: EVENT_SUB_HANDLER_GROUPS.rewardUpdateEvents,
        register: eventSubListener => eventSubListener.onChannelRewardUpdate(
          state.broadcasterId,
          createEventHandler(event => handleRewardEvent('reward.update', event), 'rewardsLastError', 'reward update')
        )
      })
    }

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.rewardRemoveEvents)) {
      registrations.push({
        group: EVENT_SUB_HANDLER_GROUPS.rewardRemoveEvents,
        register: eventSubListener => eventSubListener.onChannelRewardRemove(
          state.broadcasterId,
          createEventHandler(event => handleRewardEvent('reward.remove', event), 'rewardsLastError', 'reward remove')
        )
      })
    }

    return registrations
  }

  function getCommunitySubscriptionRegistrations(configuredGroups) {
    const registrations = []

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.follows)) {
      if (!state.broadcasterAuthUserId) {
        state.lastError = 'Broadcaster token is required for Twitch follow events'
        logger.warn(state.lastError)
      } else {
        registrations.push({
          group: EVENT_SUB_HANDLER_GROUPS.follows,
          register: eventSubListener => eventSubListener.onChannelFollow(
            state.broadcasterId,
            state.broadcasterAuthUserId,
            createEventHandler(handleFollow, 'lastError', 'follow')
          )
        })
      }
    }

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.raids)) {
      registrations.push({
        group: EVENT_SUB_HANDLER_GROUPS.raids,
        register: eventSubListener => eventSubListener.onChannelRaidTo(
          state.broadcasterId,
          createEventHandler(handleRaid, 'lastError', 'raid')
        )
      })
    }

    if (configuredGroups.has(EVENT_SUB_HANDLER_GROUPS.subscriptions)) {
      registrations.push(
        {
          group: EVENT_SUB_HANDLER_GROUPS.subscriptions,
          register: eventSubListener => eventSubListener.onChannelSubscription(
            state.broadcasterId,
            createEventHandler(handleSubscription, 'lastError', 'subscription')
          )
        },
        {
          group: EVENT_SUB_HANDLER_GROUPS.subscriptions,
          register: eventSubListener => eventSubListener.onChannelSubscriptionGift(
            state.broadcasterId,
            createEventHandler(handleSubscriptionGift, 'lastError', 'subscription gift')
          )
        }
      )
    }

    return registrations
  }

  function createEventHandler(handler, errorStateKey, label) {
    return event => {
      try {
        Promise.resolve(handler(event)).catch(error => reportEventHandlerError(errorStateKey, label, error))
      } catch (error) {
        reportEventHandlerError(errorStateKey, label, error)
      }
    }
  }

  function reportEventHandlerError(errorStateKey, label, error) {
    state[errorStateKey] = error.message
    logger.error(`Twitch ${label} handler failed: ${error.message}`)
  }

  async function handleMessage(event) {
    const context = createMessageContext(event, state)
    state.messageCount += 1
    state.lastMessageAt = new Date().toISOString()

    if (config.ignoreSelf && context.chat.chatter.id === state.botUserId) return

    if (isHighlightMessage(context, config)) {
      await automation.runHighlightAlert(context)
    }

    const chatEntryKey = getPrivilegedChatEntryKey(
      context,
      commandConfig.getSnapshot().chatEntryHandlers,
      seenChatEntrants
    )
    if (chatEntryKey) {
      seenChatEntrants.add(chatEntryKey)
      try {
        await handleChatEntry(context)
      } catch (error) {
        seenChatEntrants.delete(chatEntryKey)
        throw error
      }
    }

    if (raffle && await raffle.handleChatMessage(context)) return

    const commandMatch = automation.findCommand(
      context.message,
      commandConfig.getSnapshot().commandMap
    )
    if (!commandMatch) return

    await automation.runCommand(commandMatch, context)
  }

  async function handleChatEntry(messageContext) {
    const context = createChatEntryContext(messageContext)
    state.chatEntryCount += 1
    state.lastChatEntryAt = new Date().toISOString()
    state.lastChatEntry = summarizeChatEntryContext(context)
    state.lastChatEntryMatchedHandlers = await automation.runConfiguredHandlers(
      commandConfig.getSnapshot().chatEntryHandlers,
      context
    )
  }

  async function handleRedemption(eventName, event) {
    const context = createRedemptionContext(eventName, event)
    const currentCommandConfig = commandConfig.getSnapshot()
    const handlers = eventName === 'redemption.update'
      ? currentCommandConfig.redemptionUpdateHandlers
      : currentCommandConfig.redemptionHandlers
    return handleRedemptionContext(context, handlers)
  }

  async function handleAutomaticRedemption(event) {
    return handleRedemptionContext(
      createAutomaticRedemptionContext(event),
      commandConfig.getSnapshot().automaticRedemptionHandlers
    )
  }

  async function handleRedemptionContext(context, handlers) {
    state.redemptionCount += 1
    state.lastRedemptionAt = new Date().toISOString()
    state.lastRedemption = summarizeRedemptionContext(context)
    state.lastRedemptionMatchedHandlers = await automation.runConfiguredHandlers(handlers, context)
  }

  async function handleRewardEvent(eventName, event) {
    const context = createRewardEventContext(eventName, event)
    state.rewardEventCount += 1
    state.lastRewardEventAt = new Date().toISOString()
    state.lastRewardEvent = summarizeRewardEventContext(context)
    state.lastRewardEventMatchedHandlers = await automation.runConfiguredHandlers(
      commandConfig.getSnapshot().rewardEventHandlers,
      context
    )
  }

  async function handleFollow(event) {
    return handleCommunityEvent(createFollowContext(event), commandConfig.getSnapshot().followHandlers)
  }

  async function handleRaid(event) {
    return handleCommunityEvent(createRaidContext(event), commandConfig.getSnapshot().raidHandlers)
  }

  async function handleSubscription(event) {
    return handleCommunityEvent(createSubscriptionContext(event), commandConfig.getSnapshot().subscriptionHandlers)
  }

  async function handleSubscriptionGift(event) {
    return handleCommunityEvent(createSubscriptionGiftContext(event), commandConfig.getSnapshot().subscriptionHandlers)
  }

  async function handleCommunityEvent(context, handlers) {
    state.communityEventCount += 1
    state.lastCommunityEventAt = new Date().toISOString()
    state.lastCommunityEvent = summarizeCommunityEventContext(context)
    state.lastCommunityEventMatchedHandlers = await automation.runConfiguredHandlers(handlers, context)
  }

  /**
   * Dispatches a supported Twitch chat-message or community EventSub payload through its normal automation handler without Twitch connectivity.
   * When an action queue is configured, the promise resolves after matching actions are enqueued, not after queue completion.
   *
   * @param {string} type Supported event name or alias for chat entry, follow, raid, or subscription events.
   * @param {Record<string, unknown>} event Event payload shaped like the corresponding Twurple chat-message or EventSub event.
   * @returns {Promise<void>} Resolves after matching handlers have been dispatched.
   * @throws {Error} Rejects for unsupported event types or failures from matching automation handlers.
   */
  async function simulateEvent(type, event) {
    state.simulating = true
    await commandConfig.load()

    const normalizedType = normalizeEventName(type)
    try {
      switch (normalizedType) {
        case 'chat.entry':
          return await handleMessage(event)
        case 'follow.add':
          return await handleFollow(event)
        case 'raid.add':
          return await handleRaid(event)
        case 'subscription.add':
          return await handleSubscription(event)
        case 'subscription.gift':
          return await handleSubscriptionGift(event)
        default:
          throw new Error(`Unsupported simulated Twitch event: ${type}`)
      }
    } finally {
      state.simulating = false
    }
  }

  function applyCommandConfig(snapshot, { loaded = false } = {}) {
    state.commandCount = snapshot.commandMap.size
    state.chatEntryHandlerCount = snapshot.chatEntryHandlers.length
    state.followHandlerCount = snapshot.followHandlers.length
    state.raidHandlerCount = snapshot.raidHandlers.length
    state.subscriptionHandlerCount = snapshot.subscriptionHandlers.length
    state.communityEventHandlerCount = state.chatEntryHandlerCount + state.followHandlerCount + state.raidHandlerCount + state.subscriptionHandlerCount
    state.redemptionHandlerCount = snapshot.redemptionHandlers.length
    state.redemptionUpdateHandlerCount = snapshot.redemptionUpdateHandlers.length
    state.automaticRedemptionHandlerCount = snapshot.automaticRedemptionHandlers.length
    state.rewardEventHandlerCount = snapshot.rewardEventHandlers.length
    if (loaded) state.commandsLoadedAt = new Date().toISOString()
    state.commandsLastError = null

    const rewardHandlerCount = state.redemptionHandlerCount + state.redemptionUpdateHandlerCount + state.automaticRedemptionHandlerCount + state.rewardEventHandlerCount
    updateRewardDisabledWarning(rewardHandlerCount)
    if (loaded) {
      logger.log(`Loaded ${state.commandCount} Twitch chat command${state.commandCount === 1 ? '' : 's'}, ${rewardHandlerCount} reward handler${rewardHandlerCount === 1 ? '' : 's'}, and ${state.communityEventHandlerCount} community event handler${state.communityEventHandlerCount === 1 ? '' : 's'}`)
    }
    updateCommandsRestartRequirement()
  }

  /**
   * Returns the current serializable chat, EventSub, retry, and command-configuration state.
   *
   * @returns {ChatStatus} Current service status including listener activity.
   */
  function getStatus() {
    return {
      ...state,
      listenerActive: eventSub.isActive()
    }
  }

  function updateRewardDisabledWarning(rewardHandlerCount) {
    const message = !config.enableRedemptions && rewardHandlerCount > 0
      ? `Configured ${rewardHandlerCount} Twitch reward handler${rewardHandlerCount === 1 ? '' : 's'} will not run because CHAT_ENABLE_REDEMPTIONS=false.`
      : null

    if (message && message !== state.rewardsDisabledMessage) {
      logger.warn(message)
    }

    if (!message && state.rewardsLastError === state.rewardsDisabledMessage) {
      state.rewardsLastError = null
    }

    state.rewardsDisabledMessage = message
    if (message) state.rewardsLastError = message
  }

  function updateCommandsRestartRequirement() {
    if (!state.started || !eventSub.isActive()) {
      state.commandsRestartRequiredMessage = null
      return
    }

    const missingGroups = getMissingEventSubHandlerGroups()
    const message = missingGroups.length
      ? `Restart required for newly configured Twitch EventSub handlers: ${missingGroups.join(', ')}. Config hot reload updated the handlers, but Twitch EventSub subscriptions are created only at startup.`
      : null

    if (message && message !== state.commandsRestartRequiredMessage) {
      logger.warn(message)
    }

    state.commandsRestartRequiredMessage = message
  }

  function getMissingEventSubHandlerGroups() {
    return getUnsubscribedEventSubHandlerGroups(
      getCurrentConfiguredEventSubHandlerGroups(),
      eventSub.getSubscribedGroups()
    )
  }

  function getCurrentConfiguredEventSubHandlerGroups() {
    return getConfiguredEventSubHandlerGroupsFromSnapshot(commandConfig.getSnapshot())
  }

  return {
    getStatus,
    say,
    simulateEvent,
    start,
    stop
  }
}

async function resolveBroadcaster(api, config) {
  if (config.broadcasterId) {
    const user = await api.users.getUserById(config.broadcasterId)
    if (!user) throw new Error(`Twitch broadcaster ID was not found: ${config.broadcasterId}`)
    return user
  }

  if (!config.broadcasterLogin) {
    throw new Error('TWITCH_CHANNEL or TWITCH_CHANNEL_ID is required when CHAT_ENABLED=true')
  }

  const user = await api.users.getUserByName(config.broadcasterLogin)
  if (!user) throw new Error(`Twitch channel was not found: ${config.broadcasterLogin}`)
  return user
}

function getPrivilegedChatEntryKey(context, handlers, seenEntrants) {
  if (!handlers.length) return null
  const entryRoles = getPrivilegedEntryRoles(context.roles)
  if (!entryRoles.length) return null

  const userKey = context.userId || normalizeLogin(context.username || context.user)
  if (!userKey || seenEntrants.has(userKey)) return null

  return userKey
}

function isHighlightMessage(context, config) {
  if (!config.enableHighlightAlerts) return false
  if (context.chat.messageType === 'channel_points_highlighted') return true
  return Boolean(config.highlightRewardId && context.chat.rewardId === config.highlightRewardId)
}

function readConfig() {
  const broadcasterLogin = process.env.TWITCH_CHANNEL || process.env.TWITCH_BROADCASTER_LOGIN
  const broadcasterId = process.env.TWITCH_CHANNEL_ID || process.env.TWITCH_BROADCASTER_ID

  return {
    ...readAuthConfig(),
    broadcasterId,
    broadcasterLogin: normalizeLogin(broadcasterLogin),
    commandPrefix: process.env.CHAT_COMMAND_PREFIX || DEFAULT_COMMAND_PREFIX,
    commandsFile: resolveAppPath(process.env.CHAT_COMMANDS_FILE, DEFAULT_COMMANDS_FILE),
    defaultAlertSound: process.env.DEFAULT_ALERT_SOUND || 'example.mp3',
    enableHighlightAlerts: parseBool(process.env.CHAT_ENABLE_HIGHLIGHT_ALERTS, false),
    enableRedemptions: parseBool(process.env.CHAT_ENABLE_REDEMPTIONS, Boolean(process.env.TWITCH_BROADCASTER_REFRESH_TOKEN)),
    enabled: parseBool(process.env.CHAT_ENABLED, false),
    highlightRewardId: process.env.TWITCH_HIGHLIGHT_REWARD_ID || '',
    ignoreSelf: parseBool(process.env.CHAT_IGNORE_SELF, true),
    reconnectInitialMs: numberOrDefault(process.env.CHAT_RECONNECT_INITIAL_MS, DEFAULT_RECONNECT_INITIAL_MS),
    reconnectMaxMs: numberOrDefault(process.env.CHAT_RECONNECT_MAX_MS, DEFAULT_RECONNECT_MAX_MS)
  }
}

function normalizeLogin(value) {
  return String(value || '').trim().replace(/^#/, '').toLowerCase()
}

function numberOrDefault(value, defaultValue) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : defaultValue
}

async function loadTwurple() {
  if (twurpleModules) return twurpleModules

  const [apiModule, authModule, eventSubModule] = await Promise.all([
    import('@twurple/api'),
    import('@twurple/auth'),
    import('@twurple/eventsub-ws')
  ])

  twurpleModules = {
    ApiClient: apiModule.ApiClient,
    EventSubWsListener: eventSubModule.EventSubWsListener,
    RefreshingAuthProvider: authModule.RefreshingAuthProvider,
    StaticAuthProvider: authModule.StaticAuthProvider,
    getTokenInfo: authModule.getTokenInfo
  }

  return twurpleModules
}

module.exports = {
  FOLLOW_SCOPES,
  ChatConfigError,
  createChatService,
  getEventSubAuthRequirements,
  getConfiguredEventSubHandlerGroups,
  getUnsubscribedEventSubHandlerGroups,
  isNonRetryableStartupError,
  readTokenConfig,
  TokenConfigError,
  REDEMPTION_SCOPES,
  SUBSCRIPTION_SCOPES,
  CHAT_SCOPES
}

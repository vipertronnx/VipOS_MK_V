const fs = require('fs')
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
const { testRegex } = require('./chat-regex')
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
  normalizeRole,
  summarizeChatEntryContext,
  summarizeCommunityEventContext,
  summarizeRedemptionContext,
  summarizeRewardEventContext
} = require('./chat-context')
const {
  normalizeActionHandler,
  normalizeAutomationConfig,
  normalizeCommand,
  normalizeEventName,
  normalizeMatchValue
} = require('./chat-normalization')
const { createEventSubLifecycle } = require('./chat-eventsub')
const { createRetryScheduler } = require('./chat-retry')

const DEFAULT_COMMAND_PREFIX = '!'
const DEFAULT_COMMANDS_FILE = path.join(__dirname, '..', '..', 'config', 'commands.json')
const DEFAULT_RECONNECT_INITIAL_MS = 5000
const DEFAULT_RECONNECT_MAX_MS = 60000

let twurpleModules = null

function createChatService({ actions, actionQueue = null, logger = console, onReady = null, raffle = null, twurpleLoader = loadTwurple } = {}) {
  if (!actions) throw new Error('Chat service requires an action runner')

  const config = readConfig()
  const cooldowns = new Map()

  let api = null
  let authProvider = null
  let automaticRedemptionHandlers = []
  let chatEntryHandlers = []
  let commandMap = new Map()
  let commandWatcherStarted = false
  let commands = []
  let followHandlers = []
  let raidHandlers = []
  let redemptionHandlers = []
  let redemptionUpdateHandlers = []
  let rewardEventHandlers = []
  let subscriptionHandlers = []
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

  async function start() {
    shouldRun = true

    if (!state.enabled) {
      logger.warn('Twitch chat is disabled')
      return
    }

    if (state.started || starting) return
    starting = true

    try {
      await loadCommands()

      const twurple = await twurpleLoader()
      const auth = await createAuthProvider(twurple, config, logger, getEventSubAuthRequirements({
        config,
        followHandlers,
        subscriptionHandlers
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

      watchCommands()
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

  function stop() {
    shouldRun = false
    startupRetry.reset()
    cleanupListener()
    unwatchCommands()
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
    return [
      {
        register: eventSubListener => eventSubListener.onChannelChatMessage(
          state.broadcasterId,
          state.botUserId,
          createEventHandler(handleMessage, 'lastError', 'chat message')
        )
      },
      ...getRewardSubscriptionRegistrations(),
      ...getCommunitySubscriptionRegistrations()
    ]
  }

  function getRewardSubscriptionRegistrations() {
    const registrations = []

    if (!config.enableRedemptions) return registrations
    if (!state.broadcasterAuthUserId) {
      state.rewardsLastError = 'Broadcaster token is required for Twitch reward events'
      logger.warn(state.rewardsLastError)
      return registrations
    }

    registrations.push({
      group: 'redemptions',
      reward: true,
      register: eventSubListener => eventSubListener.onChannelRedemptionAdd(
        state.broadcasterId,
        createEventHandler(event => handleRedemption('redemption.add', event), 'rewardsLastError', 'redemption')
      )
    })

    if (redemptionUpdateHandlers.length) {
      registrations.push({
        group: 'redemption updates',
        reward: true,
        register: eventSubListener => eventSubListener.onChannelRedemptionUpdate(
          state.broadcasterId,
          createEventHandler(event => handleRedemption('redemption.update', event), 'rewardsLastError', 'redemption update')
        )
      })
    }

    if (automaticRedemptionHandlers.length) {
      registrations.push({
        group: 'automatic redemptions',
        reward: true,
        register: eventSubListener => eventSubListener.onChannelAutomaticRewardRedemptionAddV2(
          state.broadcasterId,
          createEventHandler(handleAutomaticRedemption, 'rewardsLastError', 'automatic redemption')
        )
      })
    }

    if (shouldBindRewardEvent('reward.add')) {
      registrations.push({
        group: 'reward add events',
        reward: true,
        register: eventSubListener => eventSubListener.onChannelRewardAdd(
          state.broadcasterId,
          createEventHandler(event => handleRewardEvent('reward.add', event), 'rewardsLastError', 'reward add')
        )
      })
    }

    if (shouldBindRewardEvent('reward.update')) {
      registrations.push({
        group: 'reward update events',
        reward: true,
        register: eventSubListener => eventSubListener.onChannelRewardUpdate(
          state.broadcasterId,
          createEventHandler(event => handleRewardEvent('reward.update', event), 'rewardsLastError', 'reward update')
        )
      })
    }

    if (shouldBindRewardEvent('reward.remove')) {
      registrations.push({
        group: 'reward remove events',
        reward: true,
        register: eventSubListener => eventSubListener.onChannelRewardRemove(
          state.broadcasterId,
          createEventHandler(event => handleRewardEvent('reward.remove', event), 'rewardsLastError', 'reward remove')
        )
      })
    }

    return registrations
  }

  function getCommunitySubscriptionRegistrations() {
    const registrations = []

    if (followHandlers.length) {
      if (!state.broadcasterAuthUserId) {
        state.lastError = 'Broadcaster token is required for Twitch follow events'
        logger.warn(state.lastError)
      } else {
        registrations.push({
          group: 'follows',
          register: eventSubListener => eventSubListener.onChannelFollow(
            state.broadcasterId,
            state.broadcasterAuthUserId,
            createEventHandler(handleFollow, 'lastError', 'follow')
          )
        })
      }
    }

    if (raidHandlers.length) {
      registrations.push({
        group: 'raids',
        register: eventSubListener => eventSubListener.onChannelRaidTo(
          state.broadcasterId,
          createEventHandler(handleRaid, 'lastError', 'raid')
        )
      })
    }

    if (subscriptionHandlers.length) {
      registrations.push(
        {
          group: 'subscriptions',
          register: eventSubListener => eventSubListener.onChannelSubscription(
            state.broadcasterId,
            createEventHandler(handleSubscription, 'lastError', 'subscription')
          )
        },
        {
          group: 'subscriptions',
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

  function shouldBindRewardEvent(eventName) {
    return rewardEventHandlers.some(handler => !handler.events.length || handler.events.includes(eventName))
  }

  async function handleMessage(event) {
    const context = createMessageContext(event, state)
    state.messageCount += 1
    state.lastMessageAt = new Date().toISOString()

    if (config.ignoreSelf && context.chat.chatter.id === state.botUserId) return

    if (isHighlightMessage(context, config)) {
      await runHighlightAlert(context)
    }

    const chatEntryKey = getPrivilegedChatEntryKey(context, chatEntryHandlers, seenChatEntrants)
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

    const commandMatch = findCommand(context.message)
    if (!commandMatch) return

    await runCommand(commandMatch, context)
  }

  async function handleChatEntry(messageContext) {
    const context = createChatEntryContext(messageContext)
    state.chatEntryCount += 1
    state.lastChatEntryAt = new Date().toISOString()
    state.lastChatEntry = summarizeChatEntryContext(context)
    state.lastChatEntryMatchedHandlers = await runConfiguredHandlers(chatEntryHandlers, context)
  }

  async function handleRedemption(eventName, event) {
    const context = createRedemptionContext(eventName, event)
    const handlers = eventName === 'redemption.update' ? redemptionUpdateHandlers : redemptionHandlers
    return handleRedemptionContext(context, handlers)
  }

  async function handleAutomaticRedemption(event) {
    return handleRedemptionContext(createAutomaticRedemptionContext(event), automaticRedemptionHandlers)
  }

  async function handleRedemptionContext(context, handlers) {
    state.redemptionCount += 1
    state.lastRedemptionAt = new Date().toISOString()
    state.lastRedemption = summarizeRedemptionContext(context)
    state.lastRedemptionMatchedHandlers = await runConfiguredHandlers(handlers, context)
  }

  async function handleRewardEvent(eventName, event) {
    const context = createRewardEventContext(eventName, event)
    state.rewardEventCount += 1
    state.lastRewardEventAt = new Date().toISOString()
    state.lastRewardEvent = summarizeRewardEventContext(context)
    state.lastRewardEventMatchedHandlers = await runConfiguredHandlers(rewardEventHandlers, context)
  }

  async function handleFollow(event) {
    return handleCommunityEvent(createFollowContext(event), followHandlers)
  }

  async function handleRaid(event) {
    return handleCommunityEvent(createRaidContext(event), raidHandlers)
  }

  async function handleSubscription(event) {
    return handleCommunityEvent(createSubscriptionContext(event), subscriptionHandlers)
  }

  async function handleSubscriptionGift(event) {
    return handleCommunityEvent(createSubscriptionGiftContext(event), subscriptionHandlers)
  }

  async function handleCommunityEvent(context, handlers) {
    state.communityEventCount += 1
    state.lastCommunityEventAt = new Date().toISOString()
    state.lastCommunityEvent = summarizeCommunityEventContext(context)
    state.lastCommunityEventMatchedHandlers = await runConfiguredHandlers(handlers, context)
  }

  async function simulateEvent(type, event) {
    state.simulating = true
    await loadCommands()

    const normalizedType = normalizeEventName(type)
    try {
      switch (normalizedType) {
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

  async function runCommand(commandMatch, context) {
    const { command, commandName, after, args } = commandMatch
    const commandContext = {
      ...context,
      after,
      args,
      command: commandName,
      commandName,
      chat: {
        ...context.chat,
        after,
        args,
        command: commandName
      }
    }

    if (!isAllowedRole(command.roles, commandContext.roles)) return
    if (isCoolingDown(command, commandContext)) return

    state.lastCommandAt = new Date().toISOString()
    logger.log(`Twitch command ${commandName} from ${commandContext.displayName}`)
    await runTwitchActions(`Twitch Command ${commandName}`, command.actions, commandContext)
  }

  async function runConfiguredHandlers(handlers, context) {
    let matchedCount = 0

    for (const handler of handlers) {
      if (!matchesHandler(handler, context)) continue
      if (isCoolingDown(handler, context)) continue
      matchedCount += 1
      logger.log(`Twitch ${context.event} action for ${context.displayName || context.reward.title}`)
      await runTwitchActions(formatHandlerQueueName(handler, context), handler.actions, context)
    }

    return matchedCount
  }

  async function runHighlightAlert(context) {
    const actionList = [
      {
        type: 'overlay.alert',
        message: `{displayName}: {message}`
      }
    ]

    if (config.defaultAlertSound) {
      actionList.push({
        type: 'sound.play',
        src: config.defaultAlertSound,
        volume: 1
      })
    }

    await runTwitchActions('Twitch Highlight Alert', actionList, context)
  }

  async function runTwitchActions(name, actionList, context) {
    if (!actionQueue) return actions.run(actionList, context)

    return actionQueue.enqueue({
      name,
      actions: actionList,
      context: state.simulating ? { ...context, simulated: true } : context,
      source: context.source || 'twitch'
    })
  }

  function formatHandlerQueueName(handler, context) {
    const parts = ['Twitch', context.event || 'event']
    if (handler.name) parts.push(handler.name)
    return parts.join(' ')
  }

  function findCommand(message) {
    const trimmed = String(message || '').trim()
    if (!trimmed) return null

    const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/)
    if (!match) return null

    const commandName = match[1].toLowerCase()
    const command = commandMap.get(commandName)
    if (!command) return null

    const after = (match[2] || '').trim()
    return {
      after,
      args: after ? after.split(/\s+/) : [],
      command,
      commandName
    }
  }

  function isCoolingDown(command, context) {
    const seconds = Number(command.cooldownSeconds || 0)
    if (seconds <= 0) return false

    const scope = command.cooldownScope === 'user'
      ? (context.userId || (context.chat && context.chat.chatter && context.chat.chatter.id) || 'unknown')
      : 'global'
    const key = `${command.key}:${scope}`
    const now = Date.now()
    const availableAt = cooldowns.get(key) || 0
    if (availableAt > now) return true

    cooldowns.set(key, now + seconds * 1000)
    return false
  }

  async function loadCommands() {
    if (!fs.existsSync(config.commandsFile)) {
      commands = []
      commandMap = new Map()
      chatEntryHandlers = []
      followHandlers = []
      raidHandlers = []
      subscriptionHandlers = []
      redemptionHandlers = []
      redemptionUpdateHandlers = []
      automaticRedemptionHandlers = []
      rewardEventHandlers = []
      state.commandCount = 0
      state.chatEntryHandlerCount = 0
      state.communityEventHandlerCount = 0
      state.followHandlerCount = 0
      state.raidHandlerCount = 0
      state.subscriptionHandlerCount = 0
      state.redemptionHandlerCount = 0
      state.redemptionUpdateHandlerCount = 0
      state.automaticRedemptionHandlerCount = 0
      state.rewardEventHandlerCount = 0
      updateRewardDisabledWarning(0)
      state.commandsLastError = null
      updateCommandsRestartRequirement()
      logger.warn(`Twitch commands file not found: ${relativeAppPath(config.commandsFile)}`)
      return
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(config.commandsFile, 'utf8'))
      const automationConfig = normalizeAutomationConfig(parsed)
      const nextCommands = automationConfig.commands.map(command => normalizeCommand(command, config.commandPrefix)).filter(Boolean)
      const nextCommandMap = new Map()
      const nextChatEntryHandlers = automationConfig.chatEntries.map(handler => normalizeActionHandler(handler, 'chat.entry')).filter(Boolean)
      const nextFollowHandlers = automationConfig.follows.map(handler => normalizeActionHandler(handler, 'follow.add')).filter(Boolean)
      const nextRaidHandlers = automationConfig.raids.map(handler => normalizeActionHandler(handler, 'raid.add')).filter(Boolean)
      const nextSubscriptionHandlers = automationConfig.subscriptions.map(handler => normalizeActionHandler(handler, ['subscription.add', 'subscription.gift'])).filter(Boolean)
      const nextRedemptionHandlers = automationConfig.redemptions.map(handler => normalizeActionHandler(handler, 'redemption.add')).filter(Boolean)
      const nextRedemptionUpdateHandlers = automationConfig.redemptionUpdates.map(handler => normalizeActionHandler(handler, 'redemption.update')).filter(Boolean)
      const nextAutomaticRedemptionHandlers = automationConfig.automaticRedemptions.map(handler => normalizeActionHandler(handler, 'automatic-redemption.add')).filter(Boolean)
      const nextRewardEventHandlers = automationConfig.rewardEvents.map(handler => normalizeActionHandler(handler)).filter(Boolean)

      for (const command of nextCommands) {
        for (const name of command.names) {
          if (nextCommandMap.has(name)) logger.warn(`Duplicate Twitch command ignored: ${name}`)
          else nextCommandMap.set(name, command)
        }
      }

      commands = nextCommands
      commandMap = nextCommandMap
      chatEntryHandlers = nextChatEntryHandlers
      followHandlers = nextFollowHandlers
      raidHandlers = nextRaidHandlers
      subscriptionHandlers = nextSubscriptionHandlers
      redemptionHandlers = nextRedemptionHandlers
      redemptionUpdateHandlers = nextRedemptionUpdateHandlers
      automaticRedemptionHandlers = nextAutomaticRedemptionHandlers
      rewardEventHandlers = nextRewardEventHandlers
      state.commandCount = commandMap.size
      state.chatEntryHandlerCount = chatEntryHandlers.length
      state.followHandlerCount = followHandlers.length
      state.raidHandlerCount = raidHandlers.length
      state.subscriptionHandlerCount = subscriptionHandlers.length
      state.communityEventHandlerCount = chatEntryHandlers.length + followHandlers.length + raidHandlers.length + subscriptionHandlers.length
      state.redemptionHandlerCount = redemptionHandlers.length
      state.redemptionUpdateHandlerCount = redemptionUpdateHandlers.length
      state.automaticRedemptionHandlerCount = automaticRedemptionHandlers.length
      state.rewardEventHandlerCount = rewardEventHandlers.length
      state.commandsLoadedAt = new Date().toISOString()
      state.commandsLastError = null
      const rewardHandlerCount = state.redemptionHandlerCount + state.redemptionUpdateHandlerCount + state.automaticRedemptionHandlerCount + state.rewardEventHandlerCount
      updateRewardDisabledWarning(rewardHandlerCount)
      logger.log(`Loaded ${state.commandCount} Twitch chat command${state.commandCount === 1 ? '' : 's'}, ${rewardHandlerCount} reward handler${rewardHandlerCount === 1 ? '' : 's'}, and ${state.communityEventHandlerCount} community event handler${state.communityEventHandlerCount === 1 ? '' : 's'}`)
      updateCommandsRestartRequirement()
    } catch (error) {
      state.commandsLastError = error.message
      logger.error(`Failed to load Twitch commands from ${relativeAppPath(config.commandsFile)}: ${error.message}`)
    }
  }

  function watchCommands() {
    if (commandWatcherStarted) return

    commandWatcherStarted = true
    fs.watchFile(config.commandsFile, { interval: 1000 }, () => {
      loadCommands().catch(error => {
        state.lastError = error.message
        logger.error(`Failed to reload Twitch commands: ${error.message}`)
      })
    })
  }

  function unwatchCommands() {
    if (!commandWatcherStarted) return
    fs.unwatchFile(config.commandsFile)
    commandWatcherStarted = false
  }

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
    return getConfiguredEventSubHandlerGroups({
      automaticRedemptionHandlerCount: automaticRedemptionHandlers.length,
      followHandlerCount: followHandlers.length,
      raidHandlerCount: raidHandlers.length,
      redemptionHandlerCount: redemptionHandlers.length,
      redemptionUpdateHandlerCount: redemptionUpdateHandlers.length,
      rewardAddEventHandlerCount: shouldBindRewardEvent('reward.add') ? 1 : 0,
      rewardRemoveEventHandlerCount: shouldBindRewardEvent('reward.remove') ? 1 : 0,
      rewardUpdateEventHandlerCount: shouldBindRewardEvent('reward.update') ? 1 : 0,
      subscriptionHandlerCount: subscriptionHandlers.length
    })
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

function isAllowedRole(allowedRoles, actualRoles) {
  if (!allowedRoles.length) return true

  const actual = new Set(actualRoles.map(normalizeRole))
  return allowedRoles.some(role => role === 'everyone' || actual.has(role))
}

function isHighlightMessage(context, config) {
  if (!config.enableHighlightAlerts) return false
  if (context.chat.messageType === 'channel_points_highlighted') return true
  return Boolean(config.highlightRewardId && context.chat.rewardId === config.highlightRewardId)
}

function matchesHandler(handler, context) {
  if (handler.events.length && !handler.events.includes(context.event)) return false

  const rewardId = normalizeMatchValue(context.reward && context.reward.id)
  const rewardTitle = normalizeMatchValue(context.reward && context.reward.title)
  const rewardType = normalizeMatchValue(
    (context.automaticReward && context.automaticReward.type) ||
    (context.reward && context.reward.type)
  )
  const status = normalizeMatchValue(context.redemption && context.redemption.status)
  const userId = normalizeMatchValue(context.userId)
  const username = normalizeMatchValue(context.username || context.user)
  const displayName = normalizeMatchValue(context.displayName)
  const input = normalizeMatchValue(context.input || context.message)
  const actualRoles = new Set((context.roles || []).map(normalizeRole))
  const viewerCount = Number(context.viewers || (context.raid && context.raid.viewers) || 0)

  if (handler.rewardIds.length && !handler.rewardIds.includes(rewardId)) return false
  if (handler.rewardTitles.length && !handler.rewardTitles.includes(rewardTitle)) return false
  if (handler.rewardTypes.length && !handler.rewardTypes.includes(rewardType)) return false
  if (handler.statuses.length && !handler.statuses.includes(status)) return false
  if (handler.userIds.length && !handler.userIds.includes(userId)) return false
  if (handler.usernames.length && !handler.usernames.includes(username) && !handler.usernames.includes(displayName)) return false
  if (handler.roles.length && !handler.roles.some(role => actualRoles.has(role))) return false
  if (handler.inputContains.length && !handler.inputContains.some(value => input.includes(value))) return false
  if (handler.inputPatterns.length && !handler.inputPatterns.some(pattern => testRegex(pattern, context.input || context.message || ''))) return false
  if (handler.minViewers !== null && viewerCount < handler.minViewers) return false
  if (handler.maxViewers !== null && viewerCount > handler.maxViewers) return false

  return true
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
    followHandlerCount ? 'follows' : '',
    raidHandlerCount ? 'raids' : '',
    subscriptionHandlerCount ? 'subscriptions' : '',
    redemptionHandlerCount ? 'redemptions' : '',
    redemptionUpdateHandlerCount ? 'redemption updates' : '',
    automaticRedemptionHandlerCount ? 'automatic redemptions' : '',
    rewardAddEventHandlerCount ? 'reward add events' : '',
    rewardUpdateEventHandlerCount ? 'reward update events' : '',
    rewardRemoveEventHandlerCount ? 'reward remove events' : ''
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

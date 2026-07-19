const { normalizeRole } = require('./chat-context')
const { normalizeMatchValue } = require('./chat-normalization')
const { testRegex } = require('./chat-regex')

function createChatAutomation({
  actions,
  actionQueue = null,
  defaultAlertSound = '',
  isSimulating = () => false,
  logger = console,
  onCommandAccepted = () => {}
} = {}) {
  const cooldowns = new Map()

  function findCommand(message, commandMap) {
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

    onCommandAccepted(commandContext)
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
        message: '{displayName}: {message}'
      }
    ]

    if (defaultAlertSound) {
      actionList.push({
        type: 'sound.play',
        src: defaultAlertSound,
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
      context: isSimulating() ? { ...context, simulated: true } : context,
      source: context.source || 'twitch'
    })
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

  return {
    findCommand,
    runCommand,
    runConfiguredHandlers,
    runHighlightAlert
  }
}

function formatHandlerQueueName(handler, context) {
  const parts = ['Twitch', context.event || 'event']
  if (handler.name) parts.push(handler.name)
  return parts.join(' ')
}

function isAllowedRole(allowedRoles, actualRoles) {
  if (!allowedRoles.length) return true

  const actual = new Set(actualRoles.map(normalizeRole))
  return allowedRoles.some(role => role === 'everyone' || actual.has(role))
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

module.exports = {
  createChatAutomation
}

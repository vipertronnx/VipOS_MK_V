// Pure chat automation configuration normalization.
const { normalizeRegex } = require('./chat-regex')
const { normalizeRole } = require('./chat-context')
const { asArray } = require('../utils/value-normalization')

function normalizeAutomationConfig(parsed) {
  if (Array.isArray(parsed)) {
    return {
      automaticRedemptions: [],
      chatEntries: [],
      commands: parsed,
      follows: [],
      raids: [],
      redemptions: [],
      redemptionUpdates: [],
      rewardEvents: [],
      subscriptions: []
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('commands.json must contain an array or an object')
  }

  return {
    automaticRedemptions: asArray(parsed.automaticRedemptions || parsed.automaticRewards),
    chatEntries: asArray(parsed.chatEntries || parsed.chatEntrants || parsed.entries || parsed.entryAlerts),
    commands: asArray(parsed.commands),
    follows: asArray(parsed.follows || parsed.followers || parsed.followEvents),
    raids: asArray(parsed.raids || parsed.raidEvents),
    redemptions: asArray(parsed.redemptions || parsed.rewardRedemptions),
    redemptionUpdates: asArray(parsed.redemptionUpdates),
    rewardEvents: asArray(parsed.rewardEvents),
    subscriptions: asArray(parsed.subscriptions || parsed.subs || parsed.subscriptionEvents)
  }
}

function normalizeCommand(command, commandPrefix) {
  if (!command || typeof command !== 'object' || command.enabled === false) return null

  const names = [
    command.command,
    ...(Array.isArray(command.commands) ? command.commands : []),
    ...(Array.isArray(command.aliases) ? command.aliases : [])
  ].filter(Boolean).map(name => normalizeCommandName(name, commandPrefix)).filter(Boolean)

  if (!names.length || !command.actions) return null

  return {
    actions: command.actions,
    cooldownScope: command.cooldownScope === 'user' ? 'user' : 'global',
    cooldownSeconds: Number(command.cooldownSeconds || 0),
    key: names[0],
    names,
    roles: normalizeRoles(command.roles)
  }
}

function normalizeActionHandler(handler, defaultEvent) {
  if (!handler || typeof handler !== 'object' || handler.enabled === false) return null
  if (!handler.actions) return null

  const match = handler.match && typeof handler.match === 'object' ? handler.match : {}
  const events = normalizeEventList(match.event || match.events || handler.event || handler.events || defaultEvent)
  const rewardIds = normalizeMatchList(match.rewardId || match.rewardIds || handler.rewardId || handler.rewardIds || handler.id)
  const rewardTitles = normalizeMatchList(match.rewardTitle || match.rewardTitles || match.title || match.titles || handler.rewardTitle || handler.rewardTitles || handler.title)
  const rewardTypes = normalizeMatchList(match.rewardType || match.rewardTypes || match.type || match.types || handler.rewardType || handler.rewardTypes || handler.type)
  const statuses = normalizeMatchList(match.status || match.statuses || handler.status || handler.statuses)
  const userIds = normalizeMatchList(match.userId || match.userIds || handler.userId || handler.userIds)
  const usernames = normalizeMatchList(match.username || match.usernames || match.userName || match.userNames || match.displayName || match.displayNames || handler.username || handler.usernames || handler.userName || handler.userNames || handler.displayName || handler.displayNames)
  const inputContains = normalizeMatchList(match.inputContains || match.messageContains || handler.inputContains || handler.messageContains)
  const inputPatterns = normalizeRegexList(match.inputMatches || match.messageMatches || match.inputPattern || handler.inputMatches || handler.messageMatches || handler.inputPattern)
  const minViewers = numberOrNull(match.minViewers || match.minimumViewers || handler.minViewers || handler.minimumViewers)
  const maxViewers = numberOrNull(match.maxViewers || match.maximumViewers || handler.maxViewers || handler.maximumViewers)
  const roles = normalizeRoles(match.role || match.roles || handler.role || handler.roles)
  const name = normalizeMatchValue(match.name || handler.name)
  const keyParts = [
    events.join(',') || defaultEvent || 'reward',
    name,
    rewardIds.join(','),
    rewardTitles.join(','),
    rewardTypes.join(','),
    statuses.join(','),
    userIds.join(','),
    usernames.join(','),
    roles.join(','),
    inputContains.join(','),
    inputPatterns.map(pattern => pattern.source).join(','),
    minViewers === null ? '' : `min${minViewers}`,
    maxViewers === null ? '' : `max${maxViewers}`
  ].filter(Boolean)

  return {
    actions: handler.actions,
    cooldownScope: handler.cooldownScope === 'user' ? 'user' : 'global',
    cooldownSeconds: Number(handler.cooldownSeconds || 0),
    events,
    key: keyParts.join(':'),
    inputContains,
    inputPatterns,
    maxViewers,
    minViewers,
    name,
    rewardIds,
    rewardTitles,
    rewardTypes,
    roles,
    statuses,
    userIds,
    usernames
  }
}

function normalizeCommandName(name, commandPrefix) {
  const normalized = String(name || '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized.startsWith(commandPrefix)) return normalized
  return `${commandPrefix}${normalized}`
}

function normalizeRoles(roles) {
  return asArray(roles).map(normalizeRole).filter(Boolean)
}

function normalizeMatchList(value) {
  return asArray(value).map(normalizeMatchValue).filter(Boolean)
}

function normalizeMatchValue(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeRegexList(value) {
  return asArray(value).map(normalizeRegex).filter(Boolean)
}

function normalizeEventList(value) {
  return asArray(value).map(normalizeEventName).filter(Boolean)
}

function normalizeEventName(value) {
  const normalized = normalizeMatchValue(value).replace(/_/g, '.')
  const aliases = {
    add: 'reward.add',
    automatic: 'automatic-redemption.add',
    automaticRedemption: 'automatic-redemption.add',
    automaticredemption: 'automatic-redemption.add',
    chatEntry: 'chat.entry',
    chatentry: 'chat.entry',
    enter: 'chat.entry',
    entry: 'chat.entry',
    follow: 'follow.add',
    followed: 'follow.add',
    follower: 'follow.add',
    gift: 'subscription.gift',
    giftsub: 'subscription.gift',
    'gift-sub': 'subscription.gift',
    gifted: 'subscription.gift',
    giftedsub: 'subscription.gift',
    'gifted-sub': 'subscription.gift',
    raid: 'raid.add',
    raided: 'raid.add',
    redemption: 'redemption.add',
    redeemed: 'redemption.add',
    remove: 'reward.remove',
    sub: 'subscription.add',
    subs: 'subscription.add',
    subscribe: 'subscription.add',
    subscribed: 'subscription.add',
    subscriber: 'subscription.add',
    subscribers: 'subscription.add',
    subscription: 'subscription.add',
    subscriptiongift: 'subscription.gift',
    'subscription-gift': 'subscription.gift',
    subscriptions: 'subscription.add',
    update: 'reward.update'
  }

  return aliases[normalized] || normalized
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

module.exports = {
  normalizeActionHandler,
  normalizeAutomationConfig,
  normalizeCommand,
  normalizeEventName,
  normalizeMatchValue,
  normalizeRole
}

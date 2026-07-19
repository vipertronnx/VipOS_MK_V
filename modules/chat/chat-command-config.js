const fs = require('fs')
const {
  normalizeActionHandler,
  normalizeAutomationConfig,
  normalizeCommand
} = require('./chat-normalization')

function createCommandConfigLifecycle({
  commandPrefix,
  commandsFile,
  fileSystem = fs,
  logger = console,
  onError = () => {},
  onLoaded = () => {},
  onMissing = () => {},
  onReloadError = () => {}
} = {}) {
  let snapshot = createEmptySnapshot()
  let watching = false

  async function load() {
    if (!fileSystem.existsSync(commandsFile)) {
      snapshot = createEmptySnapshot()
      onMissing(snapshot)
      return snapshot
    }

    try {
      const nextSnapshot = createSnapshot(
        JSON.parse(fileSystem.readFileSync(commandsFile, 'utf8')),
        commandPrefix,
        logger
      )
      snapshot = nextSnapshot
      onLoaded(snapshot)
      return snapshot
    } catch (error) {
      onError(error)
      return snapshot
    }
  }

  function getSnapshot() {
    return snapshot
  }

  function watch() {
    if (watching) return

    watching = true
    fileSystem.watchFile(commandsFile, { interval: 1000 }, () => {
      load().catch(onReloadError)
    })
  }

  function unwatch() {
    if (!watching) return
    fileSystem.unwatchFile(commandsFile)
    watching = false
  }

  return {
    getSnapshot,
    load,
    unwatch,
    watch
  }
}

function createEmptySnapshot() {
  return {
    automaticRedemptionHandlers: [],
    chatEntryHandlers: [],
    commandMap: new Map(),
    followHandlers: [],
    raidHandlers: [],
    redemptionHandlers: [],
    redemptionUpdateHandlers: [],
    rewardEventHandlers: [],
    subscriptionHandlers: []
  }
}

function createSnapshot(parsed, commandPrefix, logger) {
  const automationConfig = normalizeAutomationConfig(parsed)
  const commands = automationConfig.commands
    .map(command => normalizeCommand(command, commandPrefix))
    .filter(Boolean)
  const commandMap = new Map()

  for (const command of commands) {
    for (const name of command.names) {
      if (commandMap.has(name)) logger.warn(`Duplicate Twitch command ignored: ${name}`)
      else commandMap.set(name, command)
    }
  }

  return {
    automaticRedemptionHandlers: normalizeHandlers(automationConfig.automaticRedemptions, 'automatic-redemption.add'),
    chatEntryHandlers: normalizeHandlers(automationConfig.chatEntries, 'chat.entry'),
    commandMap,
    followHandlers: normalizeHandlers(automationConfig.follows, 'follow.add'),
    raidHandlers: normalizeHandlers(automationConfig.raids, 'raid.add'),
    redemptionHandlers: normalizeHandlers(automationConfig.redemptions, 'redemption.add'),
    redemptionUpdateHandlers: normalizeHandlers(automationConfig.redemptionUpdates, 'redemption.update'),
    rewardEventHandlers: normalizeHandlers(automationConfig.rewardEvents),
    subscriptionHandlers: normalizeHandlers(automationConfig.subscriptions, ['subscription.add', 'subscription.gift'])
  }
}

function normalizeHandlers(handlers, defaultEvent) {
  return handlers.map(handler => normalizeActionHandler(handler, defaultEvent)).filter(Boolean)
}

module.exports = {
  createCommandConfigLifecycle
}

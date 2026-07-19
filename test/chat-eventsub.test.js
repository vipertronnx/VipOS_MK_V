const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  ChatConfigError,
  createChatService,
  getEventSubAuthRequirements,
  getConfiguredEventSubHandlerGroups,
  getUnsubscribedEventSubHandlerGroups,
  isNonRetryableStartupError,
  readTokenConfig,
  TokenConfigError
} = require('../modules/chat/chat')

function withTempDirectory(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-chat-'))
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true })

  try {
    const result = fn(directory)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

function withEnv(overrides, fn) {
  const previousValues = new Map()
  for (const key of Object.keys(overrides)) {
    previousValues.set(key, process.env[key])
    if (overrides[key] === undefined) delete process.env[key]
    else process.env[key] = overrides[key]
  }

  const restore = () => {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  try {
    const result = fn()
    if (result && typeof result.then === 'function') {
      return result.finally(restore)
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  assert.fail('Timed out waiting for condition')
}

function createTwurpleStub({ getTokenInfo, onChatMessage = () => {} }) {
  class ApiClient {
    constructor() {
      this.users = {
        getUserById: async id => ({ id, name: 'bot' }),
        getUserByName: async name => ({ id: 'channel-123', name })
      }
    }
  }

  class EventSubWsListener {
    constructor() {
      this.isActive = false
    }

    onChannelChatMessage(broadcasterId, botUserId, handler) {
      onChatMessage({ broadcasterId, botUserId, handler })
    }
    onRevoke() {}
    onSubscriptionCreateFailure() {}
    onSubscriptionCreateSuccess() {}
    onUserSocketConnect() {}
    onUserSocketDisconnect() {}
    start() {
      this.isActive = true
    }
    stop() {
      this.isActive = false
    }
  }

  return {
    ApiClient,
    EventSubWsListener,
    StaticAuthProvider: class StaticAuthProvider {},
    getTokenInfo
  }
}

function createChatMessage({
  badges = {},
  displayName = 'Viewer',
  message = '',
  userId = 'viewer-1',
  username = 'viewer'
} = {}) {
  return {
    badges,
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    chatterDisplayName: displayName,
    chatterId: userId,
    chatterName: username,
    color: '#ffffff',
    isCheer: false,
    isRedemption: false,
    messageId: `message-${userId}-${message}`,
    messageText: message,
    messageType: 'text',
    rewardId: null
  }
}

async function withChatCommandHarness(commands, fn) {
  await withTempDirectory(async directory => {
    const commandsFile = path.join(directory, 'commands.json')
    const tokenFile = path.join(directory, 'missing-token.json')
    fs.writeFileSync(commandsFile, JSON.stringify({ commands }))

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLE_HIGHLIGHT_ALERTS: 'false',
      CHAT_ENABLE_REDEMPTIONS: 'false',
      CHAT_ENABLED: 'true',
      TWITCH_BOT_ACCESS_TOKEN: 'test-access-token',
      TWITCH_BOT_REFRESH_TOKEN: undefined,
      TWITCH_BOT_TOKEN: undefined,
      TWITCH_BOT_USER_ID: undefined,
      TWITCH_BROADCASTER_ACCESS_TOKEN: undefined,
      TWITCH_BROADCASTER_REFRESH_TOKEN: undefined,
      TWITCH_CHANNEL: 'test-channel',
      TWITCH_CHANNEL_ID: undefined,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_CLIENT_SECRET: undefined,
      TWITCH_HIGHLIGHT_REWARD_ID: undefined,
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      const queued = []
      let chatMessageHandler = null
      const chat = createChatService({
        actionQueue: {
          enqueue(item) {
            queued.push(item)
            return { queued: true }
          }
        },
        actions: {},
        logger: { error() {}, log() {}, warn() {} },
        twurpleLoader: async () => createTwurpleStub({
          async getTokenInfo() {
            return { scopes: [], userId: 'bot-123' }
          },
          onChatMessage({ handler }) {
            chatMessageHandler = handler
          }
        })
      })

      try {
        await chat.start()
        assert.equal(typeof chatMessageHandler, 'function')
        await fn({
          chat,
          queued,
          sendMessage(event) {
            chatMessageHandler(event)
          }
        })
      } finally {
        chat.stop()
      }
    })
  })
}

test('chat commands enqueue configured actions with alias and argument context', async () => {
  const actions = [{ type: 'overlay.alert', message: '{after}' }]

  await withChatCommandHarness([
    {
      actions,
      aliases: ['!say'],
      command: '!announce',
      cooldownSeconds: 60,
      roles: ['mod']
    }
  ], async ({ chat, queued, sendMessage }) => {
    sendMessage(createChatMessage({
      badges: { moderator: '1' },
      displayName: 'Moderator',
      message: '!SAY  hello   world',
      userId: 'moderator-1',
      username: 'moderator'
    }))

    await waitFor(() => queued.length === 1)

    sendMessage(createChatMessage({
      badges: { moderator: '1' },
      displayName: 'Moderator',
      message: '!announce another message',
      userId: 'moderator-1',
      username: 'moderator'
    }))
    await waitFor(() => chat.getStatus().messageCount === 2)
    assert.equal(queued.length, 1)

    const [queueItem] = queued
    assert.deepEqual(queueItem.actions, actions)
    assert.equal(queueItem.name, 'Twitch Command !say')
    assert.equal(queueItem.source, 'chat')
    assert.deepEqual({
      after: queueItem.context.after,
      args: queueItem.context.args,
      command: queueItem.context.command,
      commandName: queueItem.context.commandName,
      displayName: queueItem.context.displayName,
      roles: queueItem.context.roles,
      source: queueItem.context.source,
      userId: queueItem.context.userId
    }, {
      after: 'hello   world',
      args: ['hello', 'world'],
      command: '!say',
      commandName: '!say',
      displayName: 'Moderator',
      roles: ['everyone', 'moderator'],
      source: 'chat',
      userId: 'moderator-1'
    })
    assert.deepEqual({
      after: queueItem.context.chat.after,
      args: queueItem.context.chat.args,
      command: queueItem.context.chat.command,
      roles: queueItem.context.chat.roles
    }, {
      after: 'hello   world',
      args: ['hello', 'world'],
      command: '!say',
      roles: ['everyone', 'moderator']
    })
  })
})

test('chat commands reject users without an allowed role', async () => {
  await withChatCommandHarness([
    {
      actions: [{ type: 'overlay.alert', message: 'Restricted' }],
      command: '!restricted',
      roles: ['moderator']
    }
  ], async ({ chat, queued, sendMessage }) => {
    sendMessage(createChatMessage({ message: '!restricted' }))

    await waitFor(() => chat.getStatus().messageCount === 1)

    assert.deepEqual(queued, [])
  })
})

test('chat command cooldowns apply globally or per user as configured', async () => {
  await withChatCommandHarness([
    {
      actions: [{ type: 'overlay.alert', message: 'Global' }],
      command: '!global',
      cooldownSeconds: 60,
      roles: ['everyone']
    },
    {
      actions: [{ type: 'overlay.alert', message: 'User' }],
      command: '!user',
      cooldownScope: 'user',
      cooldownSeconds: 60,
      roles: ['everyone']
    }
  ], async ({ queued, sendMessage }) => {
    sendMessage(createChatMessage({ message: '!global', userId: 'viewer-1' }))
    sendMessage(createChatMessage({ message: '!global', userId: 'viewer-2' }))
    sendMessage(createChatMessage({ message: '!user', userId: 'viewer-1' }))
    sendMessage(createChatMessage({ message: '!user', userId: 'viewer-1' }))
    sendMessage(createChatMessage({ message: '!user', userId: 'viewer-2' }))

    await waitFor(() => queued.length === 3)

    assert.deepEqual(queued.map(item => ({
      name: item.name,
      userId: item.context.userId
    })), [
      { name: 'Twitch Command !global', userId: 'viewer-1' },
      { name: 'Twitch Command !user', userId: 'viewer-1' },
      { name: 'Twitch Command !user', userId: 'viewer-2' }
    ])
  })
})

test('configured EventSub handler groups match restart-warning group names', () => {
  const groups = getConfiguredEventSubHandlerGroups({
    automaticRedemptionHandlerCount: 1,
    followHandlerCount: 1,
    raidHandlerCount: 1,
    redemptionHandlerCount: 1,
    redemptionUpdateHandlerCount: 1,
    rewardAddEventHandlerCount: 1,
    rewardRemoveEventHandlerCount: 1,
    rewardUpdateEventHandlerCount: 1,
    subscriptionHandlerCount: 1
  })

  assert.deepEqual([...groups], [
    'follows',
    'raids',
    'subscriptions',
    'redemptions',
    'redemption updates',
    'automatic redemptions',
    'reward add events',
    'reward update events',
    'reward remove events'
  ])
})

test('EventSub restart comparison reports only newly configured groups', () => {
  const configuredGroups = getConfiguredEventSubHandlerGroups({
    followHandlerCount: 1,
    raidHandlerCount: 1,
    rewardUpdateEventHandlerCount: 1
  })
  const subscribedGroups = new Set(['follows'])

  assert.deepEqual(
    getUnsubscribedEventSubHandlerGroups(configuredGroups, subscribedGroups),
    ['raids', 'reward update events']
  )
})

test('raid-only EventSub handlers do not require broadcaster token auth', () => {
  assert.deepEqual(
    getEventSubAuthRequirements({
      config: { enableRedemptions: false },
      raidHandlers: [{}]
    }),
    {
      needsBroadcasterToken: false,
      needsFollowScopes: false,
      needsSubscriptionScopes: false
    }
  )
})

test('follow, subscription, and redemption EventSub handlers still require broadcaster token auth', () => {
  assert.equal(
    getEventSubAuthRequirements({
      config: { enableRedemptions: false },
      followHandlers: [{}]
    }).needsBroadcasterToken,
    true
  )
  assert.equal(
    getEventSubAuthRequirements({
      config: { enableRedemptions: false },
      subscriptionHandlers: [{}]
    }).needsBroadcasterToken,
    true
  )
  assert.equal(
    getEventSubAuthRequirements({
      config: { enableRedemptions: true }
    }).needsBroadcasterToken,
    true
  )
})

test('malformed Twitch token files are non-retryable startup errors', () => {
  withTempDirectory(directory => {
    const tokenFile = path.join(directory, 'twitch-token.json')
    fs.writeFileSync(tokenFile, '{not json')

    assert.throws(
      () => readTokenConfig(tokenFile),
      error => (
        error instanceof TokenConfigError &&
        isNonRetryableStartupError(error) &&
        /Failed to load Twitch token file/.test(error.message)
      )
    )
  })
})

test('non-object Twitch token files are non-retryable startup errors', () => {
  withTempDirectory(directory => {
    const tokenFile = path.join(directory, 'twitch-token.json')
    fs.writeFileSync(tokenFile, '[]')

    assert.throws(
      () => readTokenConfig(tokenFile),
      error => (
        error instanceof TokenConfigError &&
        isNonRetryableStartupError(error) &&
        /token file must contain a JSON object/.test(error.message)
      )
    )
  })
})

test('Twitch token file read failures remain retryable startup errors', () => {
  withTempDirectory(directory => {
    const tokenFile = path.join(directory, 'twitch-token.json')
    const originalReadFileSync = fs.readFileSync
    fs.writeFileSync(tokenFile, '{}')

    fs.readFileSync = function readFileSyncWithFailure(filePath, ...args) {
      if (path.resolve(filePath) === path.resolve(tokenFile)) {
        const error = new Error('temporary read failure')
        error.code = 'EAGAIN'
        throw error
      }
      return originalReadFileSync.call(this, filePath, ...args)
    }

    try {
      assert.throws(
        () => readTokenConfig(tokenFile),
        error => (
          error.code === 'EAGAIN' &&
          !isNonRetryableStartupError(error)
        )
      )
    } finally {
      fs.readFileSync = originalReadFileSync
    }
  })
})

test('ordinary startup errors remain retryable', () => {
  assert.equal(isNonRetryableStartupError(new Error('transient failure')), false)
  assert.equal(isNonRetryableStartupError({ nonRetryable: true }), false)
})

test('missing Twitch chat config errors are non-retryable startup errors', () => {
  const error = new ChatConfigError('TWITCH_CLIENT_ID is required when CHAT_ENABLED=true')

  assert.equal(isNonRetryableStartupError(error), true)
})

test('chat startup does not schedule retry for malformed Twitch token files', async () => {
  await withTempDirectory(async directory => {
    const tokenFile = path.join(directory, 'twitch-token.json')
    const commandsFile = path.join(directory, 'commands.json')
    fs.writeFileSync(tokenFile, '{not json')
    fs.writeFileSync(commandsFile, '{"commands":[]}')

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLED: 'true',
      CHAT_RECONNECT_INITIAL_MS: '1',
      TWITCH_BOT_ACCESS_TOKEN: undefined,
      TWITCH_BOT_REFRESH_TOKEN: undefined,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      const errors = []
      let readyCount = 0
      const chat = createChatService({
        actions: {},
        logger: {
          error(message) {
            errors.push(message)
          },
          log() {},
          warn() {}
        },
        onReady() {
          readyCount += 1
        }
      })

      await chat.start()
      const status = chat.getStatus()

      assert.equal(status.nextRetryAt, null)
      assert.match(status.lastError, /Failed to load Twitch token file/)
      assert.equal(errors.length, 1)
      assert.equal(readyCount, 0)
    })
  })
})

test('chat startup does not schedule retry for missing Twitch token config', async () => {
  await withTempDirectory(async directory => {
    const commandsFile = path.join(directory, 'commands.json')
    const tokenFile = path.join(directory, 'missing-token.json')
    fs.writeFileSync(commandsFile, '{"commands":[]}')

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLE_REDEMPTIONS: 'false',
      CHAT_ENABLED: 'true',
      CHAT_RECONNECT_INITIAL_MS: '1',
      TWITCH_BOT_ACCESS_TOKEN: undefined,
      TWITCH_BOT_REFRESH_TOKEN: undefined,
      TWITCH_BOT_TOKEN: undefined,
      TWITCH_BROADCASTER_REFRESH_TOKEN: undefined,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_CLIENT_SECRET: undefined,
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      const errors = []
      let readyCount = 0
      const chat = createChatService({
        actions: {},
        logger: {
          error(message) {
            errors.push(message)
          },
          log() {},
          warn() {}
        },
        onReady() {
          readyCount += 1
        }
      })

      await chat.start()
      const status = chat.getStatus()

      assert.equal(status.nextRetryAt, null)
      assert.match(status.lastError, /TWITCH_BOT_ACCESS_TOKEN and TWITCH_BOT_REFRESH_TOKEN/)
      assert.equal(errors.length, 1)
      assert.equal(readyCount, 0)
    })
  })
})

test('chat retries a temporary startup failure before notifying readiness', async () => {
  await withTempDirectory(async directory => {
    const commandsFile = path.join(directory, 'commands.json')
    const tokenFile = path.join(directory, 'missing-token.json')
    fs.writeFileSync(commandsFile, '{"commands":[]}')

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLE_REDEMPTIONS: 'false',
      CHAT_ENABLED: 'true',
      CHAT_RECONNECT_INITIAL_MS: '1',
      CHAT_RECONNECT_MAX_MS: '1',
      TWITCH_BOT_ACCESS_TOKEN: 'test-access-token',
      TWITCH_BOT_REFRESH_TOKEN: undefined,
      TWITCH_BOT_TOKEN: undefined,
      TWITCH_CHANNEL: 'test-channel',
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      let readyCount = 0
      let tokenInfoCalls = 0
      const chat = createChatService({
        actions: {},
        logger: { error() {}, log() {}, warn() {} },
        onReady() {
          readyCount += 1
        },
        twurpleLoader: async () => createTwurpleStub({
          async getTokenInfo() {
            tokenInfoCalls += 1
            if (tokenInfoCalls === 1) throw new Error('temporary Twitch API failure')
            return { scopes: [], userId: 'bot-123' }
          }
        })
      })

      await chat.start()
      assert.equal(readyCount, 0)
      assert.equal(chat.getStatus().started, false)

      await waitFor(() => readyCount === 1)

      assert.equal(tokenInfoCalls, 2)
      assert.equal(chat.getStatus().started, true)
      chat.stop()
    })
  })
})

test('chat logs rejected asynchronous readiness handlers without failing startup', async () => {
  await withTempDirectory(async directory => {
    const commandsFile = path.join(directory, 'commands.json')
    const tokenFile = path.join(directory, 'missing-token.json')
    fs.writeFileSync(commandsFile, '{"commands":[]}')

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLE_REDEMPTIONS: 'false',
      CHAT_ENABLED: 'true',
      TWITCH_BOT_ACCESS_TOKEN: 'test-access-token',
      TWITCH_BOT_REFRESH_TOKEN: undefined,
      TWITCH_BOT_TOKEN: undefined,
      TWITCH_CHANNEL: 'test-channel',
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      const errors = []
      const chat = createChatService({
        actions: {},
        logger: {
          error(message) {
            errors.push(message)
          },
          log() {},
          warn() {}
        },
        async onReady() {
          throw new Error('raffle recovery failed')
        },
        twurpleLoader: async () => createTwurpleStub({
          async getTokenInfo() {
            return { scopes: [], userId: 'bot-123' }
          }
        })
      })

      await chat.start()

      assert.equal(chat.getStatus().started, true)
      assert.deepEqual(errors, ['Twitch chat ready handler failed: raffle recovery failed'])
      chat.stop()
    })
  })
})

test('configured reward handlers surface a disabled rewards warning', async () => {
  await withTempDirectory(async directory => {
    const commandsFile = path.join(directory, 'commands.json')
    const tokenFile = path.join(directory, 'missing-token.json')
    fs.writeFileSync(commandsFile, JSON.stringify({
      redemptions: [
        {
          name: 'hydrate',
          actions: [
            { type: 'overlay.alert', message: 'Hydrate' }
          ]
        }
      ]
    }))

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLE_REDEMPTIONS: 'false',
      CHAT_ENABLED: 'true',
      CHAT_RECONNECT_INITIAL_MS: '1',
      TWITCH_BOT_ACCESS_TOKEN: undefined,
      TWITCH_BOT_REFRESH_TOKEN: undefined,
      TWITCH_BOT_TOKEN: undefined,
      TWITCH_BROADCASTER_REFRESH_TOKEN: undefined,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_CLIENT_SECRET: undefined,
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      const warnings = []
      const chat = createChatService({
        actions: {},
        logger: {
          error() {},
          log() {},
          warn(message) {
            warnings.push(message)
          }
        }
      })

      await chat.start()
      const status = chat.getStatus()

      assert.equal(status.redemptionHandlerCount, 1)
      assert.match(status.rewardsDisabledMessage, /CHAT_ENABLE_REDEMPTIONS=false/)
      assert.equal(status.rewardsLastError, status.rewardsDisabledMessage)
      assert.equal(warnings.filter(message => /CHAT_ENABLE_REDEMPTIONS=false/.test(message)).length, 1)
    })
  })
})

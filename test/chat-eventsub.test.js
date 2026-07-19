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

function createTwurpleStub({
  getTokenInfo,
  onAutomaticRedemption = () => {},
  onChatMessage = () => {},
  onFollow = () => {},
  onRaid = () => {},
  onRedemptionAdd = () => {},
  onRedemptionUpdate = () => {},
  onRewardAdd = () => {},
  onRewardRemove = () => {},
  onRewardUpdate = () => {},
  onSubscription = () => {},
  onSubscriptionGift = () => {}
}) {
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
    onChannelRaidTo(broadcasterId, handler) {
      onRaid({ broadcasterId, handler })
    }
    onChannelFollow(broadcasterId, moderatorId, handler) {
      onFollow({ broadcasterId, handler, moderatorId })
    }
    onChannelSubscription(broadcasterId, handler) {
      onSubscription({ broadcasterId, handler })
    }
    onChannelSubscriptionGift(broadcasterId, handler) {
      onSubscriptionGift({ broadcasterId, handler })
    }
    onChannelRedemptionAdd(broadcasterId, handler) {
      onRedemptionAdd({ broadcasterId, handler })
      return { id: `channel.channel_points_custom_reward_redemption.add.${broadcasterId}` }
    }
    onChannelRedemptionUpdate(broadcasterId, handler) {
      onRedemptionUpdate({ broadcasterId, handler })
      return { id: `channel.channel_points_custom_reward_redemption.update.${broadcasterId}` }
    }
    onChannelAutomaticRewardRedemptionAddV2(broadcasterId, handler) {
      onAutomaticRedemption({ broadcasterId, handler })
      return { id: `channel.channel_points_automatic_reward_redemption.add.v2.${broadcasterId}` }
    }
    onChannelRewardAdd(broadcasterId, handler) {
      onRewardAdd({ broadcasterId, handler })
      return { id: `channel.channel_points_custom_reward.add.${broadcasterId}` }
    }
    onChannelRewardUpdate(broadcasterId, handler) {
      onRewardUpdate({ broadcasterId, handler })
      return { id: `channel.channel_points_custom_reward.update.${broadcasterId}` }
    }
    onChannelRewardRemove(broadcasterId, handler) {
      onRewardRemove({ broadcasterId, handler })
      return { id: `channel.channel_points_custom_reward.remove.${broadcasterId}` }
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

  class RefreshingAuthProvider {
    constructor() {
      this.users = []
    }

    onRefresh() {}
    onRefreshFailure() {}

    async addUserForToken(token) {
      const userId = this.users.length ? 'channel-123' : 'bot-123'
      this.users.push({ token, userId })
      return userId
    }

    getCurrentScopesForUser(userId) {
      const user = this.users.find(candidate => candidate.userId === userId)
      return user ? user.token.scope || [] : []
    }
  }

  return {
    ApiClient,
    EventSubWsListener,
    RefreshingAuthProvider,
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

function createRaidEvent({
  displayName = 'Raider',
  userId = 'raider-1',
  username = 'raider',
  viewers = 1
} = {}) {
  return {
    raidedBroadcasterDisplayName: 'Test Channel',
    raidedBroadcasterId: 'channel-123',
    raidedBroadcasterName: 'test-channel',
    raidingBroadcasterDisplayName: displayName,
    raidingBroadcasterId: userId,
    raidingBroadcasterName: username,
    viewers
  }
}

function createFollowEvent({
  displayName = 'Follower',
  userId = 'follower-1',
  username = 'follower'
} = {}) {
  return {
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    followDate: new Date('2026-07-18T00:00:00.000Z'),
    userDisplayName: displayName,
    userId,
    userName: username
  }
}

function createSubscriptionEvent({
  displayName = 'Subscriber',
  isGift = false,
  tier = '1000',
  userId = 'subscriber-1',
  username = 'subscriber'
} = {}) {
  return {
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    isGift,
    tier,
    userDisplayName: displayName,
    userId,
    userName: username
  }
}

function createSubscriptionGiftEvent({
  amount = 3,
  cumulativeAmount = 5,
  displayName = 'Gifter',
  isAnonymous = false,
  tier = '1000',
  userId = 'gifter-1',
  username = 'gifter'
} = {}) {
  return {
    amount,
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    cumulativeAmount,
    gifterDisplayName: displayName,
    gifterId: userId,
    gifterName: username,
    isAnonymous,
    tier
  }
}

function createRedemptionEvent({
  input = 'water please',
  rewardId = 'reward-1',
  rewardTitle = 'Hydrate',
  status = 'unfulfilled',
  userId = 'redeemer-1',
  username = 'redeemer'
} = {}) {
  return {
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    id: `redemption-${status}-${userId}`,
    input,
    redemptionDate: new Date('2026-07-18T00:00:00.000Z'),
    rewardCost: 100,
    rewardId,
    rewardPrompt: 'Drink water',
    rewardTitle,
    status,
    userDisplayName: 'Redeemer',
    userId,
    userName: username
  }
}

function createAutomaticRedemptionEvent({
  rewardType = 'celebration',
  userId = 'redeemer-1',
  username = 'redeemer'
} = {}) {
  return {
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    id: `automatic-redemption-${userId}`,
    messageText: 'Celebrate',
    redemptionDate: new Date('2026-07-18T00:00:00.000Z'),
    reward: {
      channelPoints: 50,
      emote: { id: 'emote-1', name: 'Celebrate' },
      type: rewardType
    },
    userDisplayName: 'Redeemer',
    userId,
    userName: username
  }
}

function createRewardEvent({
  id = 'reward-1',
  title = 'New Reward'
} = {}) {
  return {
    autoApproved: false,
    backgroundColor: '#ffffff',
    broadcasterDisplayName: 'Test Channel',
    broadcasterId: 'channel-123',
    broadcasterName: 'test-channel',
    cost: 100,
    globalCooldown: null,
    id,
    isEnabled: true,
    isInStock: true,
    isPaused: false,
    maxRedemptionsPerStream: null,
    maxRedemptionsPerUserPerStream: null,
    prompt: 'Do a thing',
    redemptionsThisStream: 0,
    title,
    userInputRequired: false
  }
}

async function withChatAutomationHarness(automationConfig, fn, {
  enableRedemptions = false,
  useBroadcasterAuth = false
} = {}) {
  await withTempDirectory(async directory => {
    const commandsFile = path.join(directory, 'commands.json')
    const tokenFile = path.join(directory, 'missing-token.json')
    const broadcasterTokenFile = path.join(directory, 'missing-broadcaster-token.json')
    fs.writeFileSync(commandsFile, JSON.stringify(automationConfig))

    await withEnv({
      CHAT_COMMANDS_FILE: commandsFile,
      CHAT_ENABLE_HIGHLIGHT_ALERTS: 'false',
      CHAT_ENABLE_REDEMPTIONS: String(enableRedemptions),
      CHAT_ENABLED: 'true',
      TWITCH_BOT_ACCESS_TOKEN: useBroadcasterAuth ? 'test-bot-access-token' : 'test-access-token',
      TWITCH_BOT_REFRESH_TOKEN: useBroadcasterAuth ? 'test-bot-refresh-token' : undefined,
      TWITCH_BOT_TOKEN: undefined,
      TWITCH_BOT_USER_ID: undefined,
      TWITCH_BROADCASTER_ACCESS_TOKEN: useBroadcasterAuth ? 'test-broadcaster-access-token' : undefined,
      TWITCH_BROADCASTER_REFRESH_TOKEN: useBroadcasterAuth ? 'test-broadcaster-refresh-token' : undefined,
      TWITCH_BROADCASTER_TOKEN_FILE: broadcasterTokenFile,
      TWITCH_CHANNEL: 'test-channel',
      TWITCH_CHANNEL_ID: undefined,
      TWITCH_CLIENT_ID: 'test-client-id',
      TWITCH_CLIENT_SECRET: useBroadcasterAuth ? 'test-client-secret' : undefined,
      TWITCH_HIGHLIGHT_REWARD_ID: undefined,
      TWITCH_TOKEN_FILE: tokenFile
    }, async () => {
      const queued = []
      let automaticRedemptionHandler = null
      let chatMessageHandler = null
      let followHandler = null
      let raidHandler = null
      let redemptionAddHandler = null
      let redemptionUpdateHandler = null
      let rewardAddHandler = null
      let rewardRemoveHandler = null
      let rewardUpdateHandler = null
      let subscriptionGiftHandler = null
      let subscriptionHandler = null
      const eventSubRegistrations = {}
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
          },
          onRaid({ handler }) {
            raidHandler = handler
          },
          onFollow(registration) {
            eventSubRegistrations.follow = registration
            followHandler = registration.handler
          },
          onSubscription(registration) {
            eventSubRegistrations.subscription = registration
            subscriptionHandler = registration.handler
          },
          onSubscriptionGift(registration) {
            eventSubRegistrations.subscriptionGift = registration
            subscriptionGiftHandler = registration.handler
          },
          onRedemptionAdd(registration) {
            eventSubRegistrations.redemptionAdd = registration
            redemptionAddHandler = registration.handler
          },
          onRedemptionUpdate(registration) {
            eventSubRegistrations.redemptionUpdate = registration
            redemptionUpdateHandler = registration.handler
          },
          onAutomaticRedemption(registration) {
            eventSubRegistrations.automaticRedemption = registration
            automaticRedemptionHandler = registration.handler
          },
          onRewardAdd(registration) {
            eventSubRegistrations.rewardAdd = registration
            rewardAddHandler = registration.handler
          },
          onRewardRemove(registration) {
            eventSubRegistrations.rewardRemove = registration
            rewardRemoveHandler = registration.handler
          },
          onRewardUpdate(registration) {
            eventSubRegistrations.rewardUpdate = registration
            rewardUpdateHandler = registration.handler
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
            assert.equal(typeof chatMessageHandler, 'function')
            chatMessageHandler(event)
          },
          sendRaid(event) {
            assert.equal(typeof raidHandler, 'function')
            raidHandler(event)
          },
          sendFollow(event) {
            assert.equal(typeof followHandler, 'function')
            followHandler(event)
          },
          sendSubscription(event) {
            assert.equal(typeof subscriptionHandler, 'function')
            subscriptionHandler(event)
          },
          sendSubscriptionGift(event) {
            assert.equal(typeof subscriptionGiftHandler, 'function')
            subscriptionGiftHandler(event)
          },
          sendRedemptionAdd(event) {
            assert.equal(typeof redemptionAddHandler, 'function')
            redemptionAddHandler(event)
          },
          sendRedemptionUpdate(event) {
            assert.equal(typeof redemptionUpdateHandler, 'function')
            redemptionUpdateHandler(event)
          },
          sendAutomaticRedemption(event) {
            assert.equal(typeof automaticRedemptionHandler, 'function')
            automaticRedemptionHandler(event)
          },
          sendRewardAdd(event) {
            assert.equal(typeof rewardAddHandler, 'function')
            rewardAddHandler(event)
          },
          sendRewardRemove(event) {
            assert.equal(typeof rewardRemoveHandler, 'function')
            rewardRemoveHandler(event)
          },
          sendRewardUpdate(event) {
            assert.equal(typeof rewardUpdateHandler, 'function')
            rewardUpdateHandler(event)
          },
          eventSubRegistrations
        })
      } finally {
        chat.stop()
      }
    })
  })
}

async function withBroadcasterChatAutomationHarness(automationConfig, fn, options = {}) {
  return withChatAutomationHarness(automationConfig, fn, {
    ...options,
    useBroadcasterAuth: true
  })
}

async function withChatCommandHarness(commands, fn) {
  return withChatAutomationHarness({ commands }, fn)
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

test('privileged chat entries queue matching handlers once per viewer', async () => {
  const actions = [{ type: 'overlay.alert', message: 'Welcome moderator' }]

  await withChatAutomationHarness({
    chatEntries: [
      {
        actions,
        match: { roles: ['moderator'] },
        name: 'privileged-entry'
      }
    ]
  }, async ({ chat, queued, sendMessage }) => {
    const event = createChatMessage({
      badges: { moderator: '1' },
      displayName: 'Moderator',
      message: 'Hello',
      userId: 'moderator-1',
      username: 'moderator'
    })

    sendMessage(event)

    await waitFor(() => (
      queued.length === 1 &&
      chat.getStatus().lastChatEntryMatchedHandlers === 1
    ))

    const [queueItem] = queued
    assert.deepEqual(queueItem.actions, actions)
    assert.equal(queueItem.name, 'Twitch chat.entry privileged-entry')
    assert.equal(queueItem.source, 'chat-entry')
    assert.deepEqual({
      entry: queueItem.context.entry,
      event: queueItem.context.event,
      roles: queueItem.context.roles,
      source: queueItem.context.source,
      userId: queueItem.context.userId
    }, {
      entry: {
        firstSeenAt: queueItem.context.entry.firstSeenAt,
        role: 'moderator',
        roles: ['moderator']
      },
      event: 'chat.entry',
      roles: ['everyone', 'moderator'],
      source: 'chat-entry',
      userId: 'moderator-1'
    })

    sendMessage({ ...event, messageId: 'message-moderator-1-return', messageText: 'Back again' })
    await waitFor(() => chat.getStatus().messageCount === 2)

    assert.equal(queued.length, 1)
    assert.equal(chat.getStatus().chatEntryCount, 1)
  })
})

test('raid callbacks queue matching handlers and respect handler cooldowns', async () => {
  const incomingRaidActions = [{ type: 'overlay.alert', message: 'Incoming raid' }]
  const largeRaidActions = [{ type: 'overlay.alert', message: 'Large raid' }]

  await withChatAutomationHarness({
    raids: [
      {
        actions: incomingRaidActions,
        name: 'incoming-raid'
      },
      {
        actions: largeRaidActions,
        cooldownScope: 'user',
        cooldownSeconds: 60,
        match: { minViewers: 25 },
        name: 'large-raid'
      }
    ]
  }, async ({ chat, queued, sendRaid }) => {
    sendRaid(createRaidEvent({ userId: 'raider-1', viewers: 50 }))

    await waitFor(() => (
      queued.length === 2 &&
      chat.getStatus().lastCommunityEventMatchedHandlers === 2
    ))

    assert.deepEqual(queued.map(item => ({
      actions: item.actions,
      name: item.name,
      source: item.source
    })), [
      {
        actions: incomingRaidActions,
        name: 'Twitch raid.add incoming-raid',
        source: 'raid'
      },
      {
        actions: largeRaidActions,
        name: 'Twitch raid.add large-raid',
        source: 'raid'
      }
    ])
    assert.deepEqual({
      event: queued[0].context.event,
      source: queued[0].context.source,
      userId: queued[0].context.userId,
      viewers: queued[0].context.viewers
    }, {
      event: 'raid.add',
      source: 'raid',
      userId: 'raider-1',
      viewers: 50
    })

    sendRaid(createRaidEvent({ userId: 'raider-2', viewers: 5 }))
    await waitFor(() => (
      queued.length === 3 &&
      chat.getStatus().lastCommunityEventMatchedHandlers === 1
    ))

    sendRaid(createRaidEvent({ userId: 'raider-1', viewers: 50 }))
    await waitFor(() => (
      queued.length === 4 &&
      chat.getStatus().lastCommunityEventMatchedHandlers === 1
    ))

    assert.deepEqual(queued.map(item => item.name), [
      'Twitch raid.add incoming-raid',
      'Twitch raid.add large-raid',
      'Twitch raid.add incoming-raid',
      'Twitch raid.add incoming-raid'
    ])
  })
})

test('broadcaster-authenticated follow and subscription callbacks queue matched handlers', async () => {
  const followActions = [{ type: 'overlay.alert', message: 'New follower' }]
  const subscriptionActions = [{ type: 'overlay.alert', message: 'New subscription' }]
  const giftActions = [{ type: 'overlay.alert', message: 'Gift subscription' }]

  await withBroadcasterChatAutomationHarness({
    follows: [
      {
        actions: followActions,
        match: { userId: 'follower-1' },
        name: 'new-follower'
      }
    ],
    subscriptions: [
      {
        actions: subscriptionActions,
        match: { event: 'subscription.add', username: 'subscriber' },
        name: 'new-subscription'
      },
      {
        actions: giftActions,
        match: { event: 'subscription.gift', username: 'gifter' },
        name: 'gift-subscription'
      }
    ]
  }, async ({
    chat,
    eventSubRegistrations,
    queued,
    sendFollow,
    sendSubscription,
    sendSubscriptionGift
  }) => {
    assert.equal(chat.getStatus().authMode, 'refreshing')
    assert.equal(chat.getStatus().broadcasterAuthUserId, 'channel-123')
    assert.deepEqual({
      followBroadcasterId: eventSubRegistrations.follow.broadcasterId,
      moderatorId: eventSubRegistrations.follow.moderatorId,
      subscriptionBroadcasterId: eventSubRegistrations.subscription.broadcasterId,
      subscriptionGiftBroadcasterId: eventSubRegistrations.subscriptionGift.broadcasterId
    }, {
      followBroadcasterId: 'channel-123',
      moderatorId: 'channel-123',
      subscriptionBroadcasterId: 'channel-123',
      subscriptionGiftBroadcasterId: 'channel-123'
    })

    sendFollow(createFollowEvent())
    sendSubscription(createSubscriptionEvent())
    sendSubscriptionGift(createSubscriptionGiftEvent())

    await waitFor(() => queued.length === 3)

    assert.deepEqual(queued.map(item => ({
      actions: item.actions,
      name: item.name,
      source: item.source
    })), [
      {
        actions: followActions,
        name: 'Twitch follow.add new-follower',
        source: 'follow'
      },
      {
        actions: subscriptionActions,
        name: 'Twitch subscription.add new-subscription',
        source: 'subscription'
      },
      {
        actions: giftActions,
        name: 'Twitch subscription.gift gift-subscription',
        source: 'subscription'
      }
    ])
    assert.deepEqual({
      event: queued[0].context.event,
      followedAt: queued[0].context.follow.followedAt,
      source: queued[0].context.source,
      userId: queued[0].context.userId
    }, {
      event: 'follow.add',
      followedAt: '2026-07-18T00:00:00.000Z',
      source: 'follow',
      userId: 'follower-1'
    })
    assert.deepEqual({
      event: queued[1].context.event,
      source: queued[1].context.source,
      tier: queued[1].context.subscription.tier,
      userId: queued[1].context.userId
    }, {
      event: 'subscription.add',
      source: 'subscription',
      tier: '1000',
      userId: 'subscriber-1'
    })
    assert.deepEqual({
      amount: queued[2].context.subscription.amount,
      event: queued[2].context.event,
      source: queued[2].context.source,
      userId: queued[2].context.userId
    }, {
      amount: 3,
      event: 'subscription.gift',
      source: 'subscription',
      userId: 'gifter-1'
    })

    sendFollow(createFollowEvent({ userId: 'other-follower', username: 'other' }))
    await waitFor(() => (
      chat.getStatus().communityEventCount === 4 &&
      chat.getStatus().lastCommunityEventMatchedHandlers === 0
    ))

    assert.equal(queued.length, 3)
  })
})

test('broadcaster-authenticated reward callbacks queue matched handlers', async () => {
  const redemptionActions = [{ type: 'overlay.alert', message: 'Redemption' }]
  const updateActions = [{ type: 'overlay.alert', message: 'Redemption update' }]
  const automaticActions = [{ type: 'overlay.alert', message: 'Automatic redemption' }]
  const rewardAddActions = [{ type: 'overlay.alert', message: 'Reward added' }]
  const rewardUpdateActions = [{ type: 'overlay.alert', message: 'Reward updated' }]
  const rewardRemoveActions = [{ type: 'overlay.alert', message: 'Reward removed' }]

  await withBroadcasterChatAutomationHarness({
    automaticRedemptions: [
      {
        actions: automaticActions,
        match: { event: 'automatic-redemption.add', rewardType: 'celebration' },
        name: 'automatic-redemption'
      }
    ],
    redemptions: [
      {
        actions: redemptionActions,
        match: {
          inputContains: 'water',
          inputMatches: '^water',
          rewardId: 'reward-1',
          rewardTitle: 'Hydrate',
          status: 'unfulfilled',
          userId: 'redeemer-1',
          username: 'redeemer'
        },
        name: 'hydrate'
      }
    ],
    redemptionUpdates: [
      {
        actions: updateActions,
        match: { rewardId: 'reward-1', status: 'fulfilled' },
        name: 'hydrate-fulfilled'
      }
    ],
    rewardEvents: [
      {
        actions: rewardAddActions,
        match: { event: 'reward.add', rewardTitle: 'New Reward' },
        name: 'reward-added'
      },
      {
        actions: rewardUpdateActions,
        match: { event: 'reward.update', rewardId: 'reward-1' },
        name: 'reward-updated'
      },
      {
        actions: rewardRemoveActions,
        match: { event: 'reward.remove', rewardId: 'reward-1' },
        name: 'reward-removed'
      }
    ]
  }, async ({
    chat,
    eventSubRegistrations,
    queued,
    sendAutomaticRedemption,
    sendRedemptionAdd,
    sendRedemptionUpdate,
    sendRewardAdd,
    sendRewardRemove,
    sendRewardUpdate
  }) => {
    assert.equal(chat.getStatus().authMode, 'refreshing')
    assert.equal(chat.getStatus().broadcasterAuthUserId, 'channel-123')
    assert.deepEqual(Object.fromEntries([
      ['automaticRedemption', eventSubRegistrations.automaticRedemption],
      ['redemptionAdd', eventSubRegistrations.redemptionAdd],
      ['redemptionUpdate', eventSubRegistrations.redemptionUpdate],
      ['rewardAdd', eventSubRegistrations.rewardAdd],
      ['rewardRemove', eventSubRegistrations.rewardRemove],
      ['rewardUpdate', eventSubRegistrations.rewardUpdate]
    ].map(([name, registration]) => [name, registration.broadcasterId])), {
      automaticRedemption: 'channel-123',
      redemptionAdd: 'channel-123',
      redemptionUpdate: 'channel-123',
      rewardAdd: 'channel-123',
      rewardRemove: 'channel-123',
      rewardUpdate: 'channel-123'
    })

    sendRedemptionAdd(createRedemptionEvent())
    sendRedemptionUpdate(createRedemptionEvent({ status: 'fulfilled' }))
    sendAutomaticRedemption(createAutomaticRedemptionEvent())
    sendRewardAdd(createRewardEvent())
    sendRewardUpdate(createRewardEvent())
    sendRewardRemove(createRewardEvent())

    await waitFor(() => (
      queued.length === 6 &&
      chat.getStatus().lastRewardEventMatchedHandlers === 1
    ))

    assert.deepEqual(queued.map(item => ({
      actions: item.actions,
      name: item.name,
      source: item.source
    })), [
      {
        actions: redemptionActions,
        name: 'Twitch redemption.add hydrate',
        source: 'redemption'
      },
      {
        actions: updateActions,
        name: 'Twitch redemption.update hydrate-fulfilled',
        source: 'redemption'
      },
      {
        actions: automaticActions,
        name: 'Twitch automatic-redemption.add automatic-redemption',
        source: 'automatic-redemption'
      },
      {
        actions: rewardAddActions,
        name: 'Twitch reward.add reward-added',
        source: 'reward'
      },
      {
        actions: rewardUpdateActions,
        name: 'Twitch reward.update reward-updated',
        source: 'reward'
      },
      {
        actions: rewardRemoveActions,
        name: 'Twitch reward.remove reward-removed',
        source: 'reward'
      }
    ])
    assert.deepEqual({
      input: queued[0].context.redemption.input,
      rewardId: queued[0].context.reward.id,
      source: queued[0].context.source,
      status: queued[0].context.redemption.status,
      userId: queued[0].context.userId
    }, {
      input: 'water please',
      rewardId: 'reward-1',
      source: 'redemption',
      status: 'unfulfilled',
      userId: 'redeemer-1'
    })
    assert.deepEqual({
      event: queued[2].context.event,
      rewardType: queued[2].context.automaticReward.type,
      source: queued[2].context.source
    }, {
      event: 'automatic-redemption.add',
      rewardType: 'celebration',
      source: 'automatic-redemption'
    })
    assert.deepEqual({
      event: queued[5].context.event,
      rewardId: queued[5].context.reward.id,
      source: queued[5].context.source,
      title: queued[5].context.reward.title
    }, {
      event: 'reward.remove',
      rewardId: 'reward-1',
      source: 'reward',
      title: 'New Reward'
    })
    assert.equal(chat.getStatus().redemptionCount, 3)
    assert.equal(chat.getStatus().rewardEventCount, 3)
    assert.equal(chat.getStatus().lastRewardEventMatchedHandlers, 1)

    sendRedemptionAdd(createRedemptionEvent({ input: 'juice please' }))
    await waitFor(() => (
      chat.getStatus().redemptionCount === 4 &&
      chat.getStatus().lastRedemptionMatchedHandlers === 0
    ))

    assert.equal(queued.length, 6)
  }, { enableRedemptions: true })
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

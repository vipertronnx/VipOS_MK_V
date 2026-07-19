const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const chat = require('../modules/chat/chat')
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
} = require('../modules/chat/chat-auth')

test('chat retains compatibility exports for authentication contracts', () => {
  assert.equal(chat.CHAT_SCOPES, CHAT_SCOPES)
  assert.equal(chat.ChatConfigError, ChatConfigError)
  assert.equal(chat.FOLLOW_SCOPES, FOLLOW_SCOPES)
  assert.equal(chat.TokenConfigError, TokenConfigError)
  assert.equal(chat.isNonRetryableStartupError, isNonRetryableStartupError)
  assert.equal(chat.readTokenConfig, readTokenConfig)
  assert.equal(chat.REDEMPTION_SCOPES, REDEMPTION_SCOPES)
  assert.equal(chat.SUBSCRIPTION_SCOPES, SUBSCRIPTION_SCOPES)
})

test('authentication configuration preserves token aliases, normalization, and path resolution', () => {
  const config = readAuthConfig({
    TWITCH_BOT_EXPIRES_IN: '3600',
    TWITCH_BOT_OBTAINMENT_TIMESTAMP: '123',
    TWITCH_BOT_SCOPES: 'user:read:chat, user:write:chat',
    TWITCH_BOT_TOKEN: 'legacy-token',
    TWITCH_BROADCASTER_SCOPES: 'moderator:read:followers channel:read:subscriptions',
    TWITCH_TOKEN_FILE: 'config/test-token.json'
  })

  assert.equal(config.botAccessToken, 'legacy-token')
  assert.equal(config.botExpiresIn, 3600)
  assert.equal(config.botObtainmentTimestamp, 123)
  assert.deepEqual(config.botScopes, ['user:read:chat', 'user:write:chat'])
  assert.deepEqual(config.broadcasterScopes, ['moderator:read:followers', 'channel:read:subscriptions'])
  assert.equal(config.tokenFile, path.join(__dirname, '..', 'config', 'test-token.json'))
})

test('static authentication preserves access-token cleanup and scope warnings', async () => {
  const warnings = []
  let staticProviderArgs = null
  const twurple = {
    StaticAuthProvider: class StaticAuthProvider {
      constructor(clientId, accessToken) {
        staticProviderArgs = { accessToken, clientId }
      }
    },
    async getTokenInfo(accessToken) {
      assert.equal(accessToken, 'test-access-token')
      return { scopes: ['user:read:chat'], userId: 'bot-123' }
    }
  }

  const auth = await createAuthProvider(twurple, {
    botAccessToken: 'oauth:test-access-token',
    clientId: 'test-client-id',
    tokenFile: path.join(__dirname, 'missing-token.json')
  }, {
    error() {},
    warn(message) {
      warnings.push(message)
    }
  })

  assert.deepEqual(staticProviderArgs, {
    accessToken: 'test-access-token',
    clientId: 'test-client-id'
  })
  assert.equal(auth.botUserId, 'bot-123')
  assert.equal(auth.mode, 'static')
  assert.deepEqual(warnings, [
    'Twitch bot token is missing recommended scope: user:write:chat',
    'Twitch chat is using a static access token; add TWITCH_BOT_REFRESH_TOKEN for durable refreshes'
  ])
})

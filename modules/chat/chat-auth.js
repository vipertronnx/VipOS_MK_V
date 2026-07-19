const fs = require('fs')
const path = require('path')
const { writeJsonFile } = require('../utils/json-file')
const { relativeAppPath, resolveAppPath } = require('../utils/app-path')

const CHAT_INTENT = 'chat'
const BROADCASTER_INTENT = 'broadcaster'
const DEFAULT_TOKEN_FILE = path.join(__dirname, '..', '..', 'config', 'twitch-token.json')
const DEFAULT_BROADCASTER_TOKEN_FILE = path.join(__dirname, '..', '..', 'config', 'twitch-broadcaster-token.json')
const CHAT_SCOPES = ['user:read:chat', 'user:write:chat']
const REDEMPTION_SCOPES = ['channel:read:redemptions', 'channel:manage:redemptions']
const FOLLOW_SCOPES = ['moderator:read:followers']
const SUBSCRIPTION_SCOPES = ['channel:read:subscriptions']

/**
 * Creates Twurple authentication from token files or configured credentials.
 * Refreshing providers register callbacks that persist later token updates and log refresh failures.
 *
 * @param {object} twurple Twurple auth constructors and token-info loader.
 * @param {object} config Normalized Twitch credential and token-file configuration.
 * @param {object} logger Logger exposing `warn` and `error` for scope and refresh diagnostics.
 * @param {object} [options] EventSub-derived broadcaster and scope requirements.
 * @returns {Promise<object>} Auth provider, bot user ID, optional broadcaster user ID, and authentication mode.
 * @throws {Error} Rejects for invalid configuration, unreadable token files, or Twurple authentication failures.
 */
async function createAuthProvider(twurple, config, logger, options = {}) {
  if (!config.clientId) throw new ChatConfigError('TWITCH_CLIENT_ID is required when CHAT_ENABLED=true')
  const needsBroadcasterToken = Boolean(options.needsBroadcasterToken)
  const needsFollowScopes = Boolean(options.needsFollowScopes)
  const needsSubscriptionScopes = Boolean(options.needsSubscriptionScopes)

  const botToken = readTokenConfig(config.tokenFile)
  const botAccessToken = cleanAccessToken(botToken.accessToken || config.botAccessToken)
  const botRefreshToken = botToken.refreshToken || config.botRefreshToken
  const botExpiresIn = botToken.expiresIn || config.botExpiresIn
  const botObtainmentTimestamp = botToken.obtainmentTimestamp || config.botObtainmentTimestamp
  const botScope = botToken.scope || config.botScopes
  let broadcasterToken = null

  if (needsBroadcasterToken) {
    if (!config.clientSecret) {
      throw new ChatConfigError('TWITCH_CLIENT_SECRET is required when broadcaster EventSub auth is needed')
    }

    if (!botRefreshToken) {
      throw new ChatConfigError('TWITCH_BOT_REFRESH_TOKEN is required when broadcaster EventSub auth is needed')
    }

    broadcasterToken = readTokenConfig(config.broadcasterTokenFile)
    if (!(broadcasterToken.refreshToken || config.broadcasterRefreshToken)) {
      throw new ChatConfigError('TWITCH_BROADCASTER_REFRESH_TOKEN is required when broadcaster EventSub auth is needed')
    }
  }

  if (botRefreshToken) {
    if (!config.clientSecret) {
      throw new ChatConfigError('TWITCH_CLIENT_SECRET is required when using TWITCH_BOT_REFRESH_TOKEN')
    }

    const authProvider = new twurple.RefreshingAuthProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret
    })

    const tokenFilesByUserId = new Map()
    let refreshTokenFile = config.tokenFile

    authProvider.onRefresh((userId, refreshedToken) => {
      persistToken(tokenFilesByUserId.get(userId) || refreshTokenFile, userId, refreshedToken, logger)
    })

    authProvider.onRefreshFailure((userId, error) => {
      logger.error(`Twitch token refresh failed for ${userId}: ${error.message}`)
    })

    refreshTokenFile = config.tokenFile
    const botUserId = await authProvider.addUserForToken(buildRefreshingToken({
      accessToken: botAccessToken,
      expiresIn: botExpiresIn,
      obtainmentTimestamp: botObtainmentTimestamp,
      refreshToken: botRefreshToken,
      scope: botScope
    }), [CHAT_INTENT])
    tokenFilesByUserId.set(botUserId, config.tokenFile)

    if (!needsBroadcasterToken) {
      warnMissingScopes(authProvider.getCurrentScopesForUser(botUserId), CHAT_SCOPES, logger)
      return { authProvider, botUserId, mode: 'refreshing' }
    }

    const broadcasterAccessToken = cleanAccessToken(broadcasterToken.accessToken || config.broadcasterAccessToken)
    const broadcasterRefreshToken = broadcasterToken.refreshToken || config.broadcasterRefreshToken
    const broadcasterExpiresIn = broadcasterToken.expiresIn || config.broadcasterExpiresIn
    const broadcasterObtainmentTimestamp = broadcasterToken.obtainmentTimestamp || config.broadcasterObtainmentTimestamp
    const broadcasterScope = broadcasterToken.scope || config.broadcasterScopes

    refreshTokenFile = config.broadcasterTokenFile
    const broadcasterUserId = await authProvider.addUserForToken(buildRefreshingToken({
      accessToken: broadcasterAccessToken,
      expiresIn: broadcasterExpiresIn,
      obtainmentTimestamp: broadcasterObtainmentTimestamp,
      refreshToken: broadcasterRefreshToken,
      scope: broadcasterScope
    }), [BROADCASTER_INTENT])
    tokenFilesByUserId.set(broadcasterUserId, config.broadcasterTokenFile)

    warnMissingScopes(authProvider.getCurrentScopesForUser(botUserId), CHAT_SCOPES, logger)
    const broadcasterScopes = authProvider.getCurrentScopesForUser(broadcasterUserId)
    if (config.enableRedemptions) {
      warnMissingAnyScope(broadcasterScopes, REDEMPTION_SCOPES, logger, 'Twitch broadcaster')
    }
    if (needsFollowScopes) {
      warnMissingScopes(broadcasterScopes, FOLLOW_SCOPES, logger, 'Twitch broadcaster token')
    }
    if (needsSubscriptionScopes) {
      warnMissingScopes(broadcasterScopes, SUBSCRIPTION_SCOPES, logger, 'Twitch broadcaster token')
    }

    return { authProvider, botUserId, broadcasterUserId, mode: 'refreshing' }
  }

  if (!botAccessToken) {
    throw new ChatConfigError('TWITCH_BOT_ACCESS_TOKEN and TWITCH_BOT_REFRESH_TOKEN are required when CHAT_ENABLED=true')
  }

  const authProvider = new twurple.StaticAuthProvider(config.clientId, botAccessToken)
  const tokenInfo = await twurple.getTokenInfo(botAccessToken)
  const botUserId = config.botUserId || tokenInfo.userId
  if (!botUserId) throw new Error('Unable to determine Twitch bot user ID from token')

  warnMissingScopes(tokenInfo.scopes, CHAT_SCOPES, logger)
  logger.warn('Twitch chat is using a static access token; add TWITCH_BOT_REFRESH_TOKEN for durable refreshes')
  return { authProvider, botUserId, mode: 'static' }
}

/**
 * Reads Twitch authentication settings from an environment-like object.
 *
 * @param {object} [env=process.env] Environment values containing Twitch credentials and file overrides.
 * @returns {object} Normalized credential, scope, timestamp, and absolute token-file settings.
 */
function readAuthConfig(env = process.env) {
  return {
    botAccessToken: env.TWITCH_BOT_ACCESS_TOKEN || env.TWITCH_BOT_TOKEN,
    botExpiresIn: numberOrUndefined(env.TWITCH_BOT_EXPIRES_IN),
    botObtainmentTimestamp: numberOrUndefined(env.TWITCH_BOT_OBTAINMENT_TIMESTAMP),
    botRefreshToken: env.TWITCH_BOT_REFRESH_TOKEN,
    botScopes: parseScopes(env.TWITCH_BOT_SCOPES),
    botUserId: env.TWITCH_BOT_USER_ID,
    botUsername: env.TWITCH_BOT_USERNAME,
    broadcasterAccessToken: env.TWITCH_BROADCASTER_ACCESS_TOKEN,
    broadcasterExpiresIn: numberOrUndefined(env.TWITCH_BROADCASTER_EXPIRES_IN),
    broadcasterObtainmentTimestamp: numberOrUndefined(env.TWITCH_BROADCASTER_OBTAINMENT_TIMESTAMP),
    broadcasterRefreshToken: env.TWITCH_BROADCASTER_REFRESH_TOKEN,
    broadcasterScopes: parseScopes(env.TWITCH_BROADCASTER_SCOPES),
    broadcasterTokenFile: resolveAppPath(env.TWITCH_BROADCASTER_TOKEN_FILE, DEFAULT_BROADCASTER_TOKEN_FILE),
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    tokenFile: resolveAppPath(env.TWITCH_TOKEN_FILE, DEFAULT_TOKEN_FILE)
  }
}

class ChatConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ChatConfigError'
  }
}

class TokenConfigError extends ChatConfigError {
  constructor(message) {
    super(message)
    this.name = 'TokenConfigError'
  }
}

/**
 * Identifies configuration errors that should prevent automatic chat startup retries.
 *
 * @param {*} error Startup failure to classify.
 * @returns {boolean} Whether the error is a `ChatConfigError` or subclass.
 */
function isNonRetryableStartupError(error) {
  return error instanceof ChatConfigError
}

/**
 * Reads supported camelCase and snake_case fields from a persisted Twitch token file.
 *
 * @param {string} tokenFile Absolute token JSON file path.
 * @returns {object} Normalized token fields, or an empty object when the file is absent.
 * @throws {Error} Throws a `TokenConfigError` for invalid JSON or a non-object document; filesystem read failures propagate unchanged.
 */
function readTokenConfig(tokenFile) {
  if (!tokenFile || !fs.existsSync(tokenFile)) return {}

  const raw = fs.readFileSync(tokenFile, 'utf8')
  let data
  try {
    data = JSON.parse(raw)
  } catch (error) {
    throw new TokenConfigError(`Failed to load Twitch token file ${relativeAppPath(tokenFile)}: ${error.message}`)
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TokenConfigError(`Failed to load Twitch token file ${relativeAppPath(tokenFile)}: token file must contain a JSON object`)
  }

  return {
    accessToken: data.accessToken || data.access_token,
    expiresIn: numberOrUndefined(data.expiresIn || data.expires_in),
    obtainmentTimestamp: numberOrUndefined(data.obtainmentTimestamp || data.obtainment_timestamp),
    refreshToken: data.refreshToken || data.refresh_token,
    scope: parseScopes(data.scope || data.scopes)
  }
}

function buildRefreshingToken({ accessToken, expiresIn, obtainmentTimestamp, refreshToken, scope }) {
  return {
    accessToken: expiresIn !== undefined && obtainmentTimestamp !== undefined ? accessToken : undefined,
    expiresIn,
    obtainmentTimestamp,
    refreshToken,
    scope
  }
}

function persistToken(tokenFile, userId, token, logger) {
  if (!tokenFile) return

  try {
    const payload = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      obtainmentTimestamp: token.obtainmentTimestamp,
      scope: token.scope,
      updatedAt: new Date().toISOString(),
      userId
    }
    writeJsonFile(tokenFile, payload)
  } catch (error) {
    logger.error(`Failed to persist Twitch token: ${error.message}`)
  }
}

function warnMissingScopes(actualScopes, requiredScopes, logger, label = 'Twitch bot token') {
  const actual = new Set(actualScopes || [])
  const missing = requiredScopes.filter(scope => !actual.has(scope))
  if (missing.length) {
    logger.warn(`${label} is missing recommended scope${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`)
  }
}

function warnMissingAnyScope(actualScopes, acceptedScopes, logger, label) {
  const actual = new Set(actualScopes || [])
  if (!acceptedScopes.some(scope => actual.has(scope))) {
    logger.warn(`${label} token is missing one of these scopes: ${acceptedScopes.join(', ')}`)
  }
}

function cleanAccessToken(value) {
  return String(value || '').trim().replace(/^oauth:/i, '') || undefined
}

function parseScopes(value) {
  if (Array.isArray(value)) return value
  if (!value) return undefined
  return String(value).split(/[,\s]+/).map(scope => scope.trim()).filter(Boolean)
}

function numberOrUndefined(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

module.exports = {
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
}

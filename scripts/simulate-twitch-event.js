require('dotenv').config({ quiet: true })

const fs = require('fs')
const path = require('path')
const { createActionQueue } = require('../modules/actions/action-queue')
const { createActionRunner } = require('../modules/actions/actions')
const { createChatService } = require('../modules/chat/chat')
const { createGreetingService } = require('../modules/actions/greetings')

const EVENT_ALIASES = {
  'chat-entry': 'chat.entry',
  chatentry: 'chat.entry',
  entry: 'chat.entry',
  follow: 'follow',
  follower: 'follow',
  followers: 'follow',
  gift: 'subscription-gift',
  giftsub: 'subscription-gift',
  'gift-sub': 'subscription-gift',
  gifted: 'subscription-gift',
  giftedsub: 'subscription-gift',
  'gifted-sub': 'subscription-gift',
  raid: 'raid',
  raided: 'raid',
  sub: 'subscription',
  subscriber: 'subscription',
  subscribers: 'subscription',
  subscribe: 'subscription',
  subscribed: 'subscription',
  subscription: 'subscription'
}

const DEFAULT_FIXTURES = {
  'chat.entry': path.join(__dirname, '..', 'fixtures', 'twitch', 'chat-entry.json'),
  follow: path.join(__dirname, '..', 'fixtures', 'twitch', 'follow.json'),
  raid: path.join(__dirname, '..', 'fixtures', 'twitch', 'raid.json'),
  subscription: path.join(__dirname, '..', 'fixtures', 'twitch', 'subscription.json'),
  'subscription-gift': path.join(__dirname, '..', 'fixtures', 'twitch', 'subscription-gift.json')
}

/**
 * Runs a fixture-based or live API simulation of a supported Twitch community event.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const eventType = normalizeEventType(options.eventType)
  if (!eventType) {
    printUsage()
    process.exitCode = 1
    return
  }

  const fixtureFile = resolveFixtureFile(eventType, options.fixtureFile)
  const event = readJson(fixtureFile)
  applyFixtureOverrides(event, options, eventType)

  if (options.live) {
    await simulateLiveEvent(eventType, event, fixtureFile, options.baseUrl)
    return
  }

  const commandsFile = resolveCommandsFile()
  process.env.CHAT_COMMANDS_FILE = commandsFile

  const emitted = []
  const io = {
    emit(eventName, payload) {
      emitted.push({ event: eventName, payload })
      console.log(`[overlay] ${eventName} ${payload ? JSON.stringify(payload) : ''}`.trim())
    }
  }
  const obs = createSimulatedObs()
  const logger = {
    log: message => console.log(`[log] ${message}`),
    warn: message => console.warn(`[warn] ${message}`),
    error: message => console.error(`[error] ${message}`)
  }

  const actions = createActionRunner({
    greetings: createGreetingService({ logger }),
    io,
    logger,
    obs
  })
  const actionQueue = createActionQueue({
    actions,
    logger,
    soundCompletionBufferMs: 0,
    soundCompletionFallbackMs: 0
  })
  const chat = createChatService({ actions, actionQueue, logger })
  actions.setChatService(chat)

  await chat.simulateEvent(eventType, event)
  const queue = await waitForQueue(actionQueue)
  const matchingHistory = queue.history.filter(item => item.source === eventType || item.source === sourceForEvent(eventType))

  console.log('')
  console.log(`Simulated Twitch ${eventType} using ${relativePath(fixtureFile)}`)
  console.log(`Commands file: ${relativePath(commandsFile)}`)
  console.log(`Queue items completed: ${matchingHistory.length}`)
  for (const item of matchingHistory) {
    console.log(`- #${item.id} ${item.name}: ${item.status}`)
  }

  if (!matchingHistory.length) {
    console.log('No matching handlers fired. Add a handler to config/commands.json or config/examples/commands.example.json.')
  }

  if (emitted.length) {
    console.log(`Overlay events emitted: ${emitted.length}`)
  }
}

/**
 * Parses the simulation CLI's positional event and fixture arguments plus supported overrides.
 *
 * @param {string[]} args Arguments after the Node script path.
 * @returns {object} Event type, optional fixture, live URL, count, tier, and chat-entry override options.
 */
function parseArgs(args) {
  const options = {
    baseUrl: `http://127.0.0.1:${Number(process.env.PORT) || 5000}`,
    count: null,
    eventType: '',
    fixtureFile: '',
    live: false,
    role: '',
    tier: '',
    userId: ''
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--live') {
      options.live = true
    } else if (arg === '--count') {
      options.count = Number(args[index + 1] || 0)
      index += 1
    } else if (arg === '--tier') {
      options.tier = args[index + 1] || ''
      index += 1
    } else if (arg === '--role') {
      options.role = getRequiredOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--user-id') {
      options.userId = getRequiredOptionValue(args, index, arg)
      index += 1
    } else if (arg === '--url') {
      options.baseUrl = args[index + 1] || options.baseUrl
      index += 1
    } else if (!options.eventType) {
      options.eventType = arg
    } else if (!options.fixtureFile) {
      options.fixtureFile = arg
    }
  }

  return options
}

function getRequiredOptionValue(args, index, option) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

function applyFixtureOverrides(event, options, eventType) {
  if (Number.isFinite(options.count) && options.count > 0) {
    event.amount = Math.round(options.count)
  }

  if (options.tier) {
    event.tier = options.tier
  }

  if (!options.role && !options.userId) return
  if (eventType !== 'chat.entry') {
    throw new Error('--role and --user-id are only supported for chat-entry simulations')
  }

  if (options.role) {
    const role = normalizeChatEntryRole(options.role)
    event.badges = { ...event.badges }
    delete event.badges.moderator
    delete event.badges.vip
    event.badges[role] = '1'
  }

  if (options.userId) {
    const userId = String(options.userId).trim()
    if (!userId) throw new Error('--user-id requires a non-empty value')
    event.chatterId = userId
    event.messageId = `simulated-chat-entry-${userId}`
  }
}

function normalizeChatEntryRole(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'mod') return 'moderator'
  if (normalized === 'moderator' || normalized === 'vip') return normalized
  throw new Error('--role must be moderator or vip')
}

/**
 * Sends a fixture payload to the running application's Twitch simulation endpoint.
 *
 * @param {string} eventType Canonical event type accepted by the API.
 * @param {object} event Fixture payload to submit as JSON.
 * @param {string} fixtureFile Source file displayed in command output.
 * @param {string} baseUrl Base URL of the locally running application.
 * @returns {Promise<void>}
 * @throws {Error} Rejects for network failures, unsuccessful responses, or successful responses that are not JSON objects.
 */
async function simulateLiveEvent(eventType, event, fixtureFile, baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/twitch/simulate/${encodeURIComponent(eventType)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  })
  const text = await response.text()
  const payload = parseResponseText(text)

  if (!response.ok) {
    throw new Error(formatHttpError(response, payload || {}, text))
  }

  if (!payload) {
    throw new Error(`Expected a JSON object response from ${url}`)
  }

  console.log(`Sent live Twitch ${eventType} simulation to ${url}`)
  console.log(`Fixture: ${relativePath(fixtureFile)}`)
  if (payload.queue) {
    const running = payload.queue.running ? `#${payload.queue.running.id} ${payload.queue.running.name}` : 'none'
    console.log(`Queue running: ${running}`)
    console.log(`Queue pending: ${(payload.queue.pending || []).length}`)
  }
}

function normalizeEventType(value) {
  const key = String(value || '').trim().toLowerCase()
  return EVENT_ALIASES[key] || null
}

function sourceForEvent(eventType) {
  if (eventType === 'chat.entry') return 'chat-entry'
  return eventType === 'subscription' || eventType === 'subscription-gift' ? 'subscription' : eventType
}

function resolveFixtureFile(eventType, value) {
  const file = value ? path.resolve(value) : DEFAULT_FIXTURES[eventType]
  if (!fs.existsSync(file)) throw new Error(`Fixture file not found: ${file}`)
  return file
}

function resolveCommandsFile() {
  if (process.env.CHAT_COMMANDS_FILE) return path.resolve(process.env.CHAT_COMMANDS_FILE)

  const configured = path.join(__dirname, '..', 'config', 'commands.json')
  if (fs.existsSync(configured)) return configured

  return path.join(__dirname, '..', 'config', 'examples', 'commands.example.json')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function waitForQueue(actionQueue, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const status = actionQueue.getStatus()
    if (!status.running && !status.pending.length) return status
    await wait(25)
  }
  throw new Error('Timed out waiting for simulated Twitch event queue to drain')
}

function createSimulatedObs() {
  return {
    async muteInput(input, muted) {
      console.log(`[obs] mute ${input}: ${muted}`)
      return { input, muted, simulated: true }
    },
    async setInputMute(input, muted) {
      console.log(`[obs] mute ${input}: ${muted}`)
      return { input, muted, simulated: true }
    },
    async setSourceVisibility(scene, source, visible) {
      console.log(`[obs] source ${scene}/${source}: ${visible}`)
      return { scene, source, visible, simulated: true }
    },
    async mediaAction(input, mediaAction) {
      console.log(`[obs] media ${input}: ${mediaAction}`)
      return { input, mediaAction, simulated: true }
    },
    async switchScene(scene) {
      console.log(`[obs] scene ${scene}`)
      return { scene, simulated: true }
    },
    async toggleInputMute(input) {
      console.log(`[obs] toggle mute ${input}`)
      return true
    },
    async toggleSourceVisibility(scene, source) {
      console.log(`[obs] toggle source ${scene}/${source}`)
      return true
    }
  }
}

function printUsage() {
  console.log('Usage: npm run simulate:twitch-event -- <chat-entry|follow|raid|sub|gift-sub> [fixture.json] [--count 5] [--tier 1000] [--role moderator|vip] [--user-id VALUE] [--live] [--url http://127.0.0.1:5000]')
}

function relativePath(file) {
  return path.relative(path.join(__dirname, '..'), file) || file
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Parses an HTTP response only when it is a JSON object.
 *
 * @param {string} text Response body text.
 * @returns {object|null} Parsed object, or `null` for empty, invalid, or non-object JSON.
 */
function parseResponseText(text) {
  if (!text) return null

  try {
    const payload = JSON.parse(text)
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch (error) {
    return null
  }
}

/**
 * Formats an unsuccessful fetch response with its JSON error or a shortened text-body fallback.
 *
 * @param {Response} response Fetch response that failed.
 * @param {object} payload Parsed JSON response object when available.
 * @param {string} text Raw response text.
 * @returns {string} Status text with optional error detail.
 */
function formatHttpError(response, payload, text) {
  const detail = payload.error || summarizeResponseText(text)
  const status = `${response.status} ${response.statusText}`
  return detail ? `${status}: ${detail}` : status
}

/**
 * Converts arbitrary response text to a single-line, length-bounded diagnostic.
 *
 * @param {*} text Response text to summarize.
 * @param {number} [maxLength=200] Maximum retained character count before an ellipsis is appended.
 * @returns {string} Whitespace-normalized diagnostic text.
 */
function summarizeResponseText(text, maxLength = 200) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[error] ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  applyFixtureOverrides,
  formatHttpError,
  normalizeEventType,
  parseArgs,
  parseResponseText,
  simulateLiveEvent,
  sourceForEvent,
  summarizeResponseText
}

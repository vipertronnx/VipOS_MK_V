require('dotenv').config({ quiet: true })

const fs = require('fs')
const path = require('path')
const { createActionQueue } = require('../modules/actions/action-queue')
const { createActionRunner } = require('../modules/actions/actions')
const { createChatService } = require('../modules/chat/chat')
const { createGreetingService } = require('../modules/chat/chat-greetings')

const EVENT_ALIASES = {
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
  follow: path.join(__dirname, '..', 'fixtures', 'twitch', 'follow.json'),
  raid: path.join(__dirname, '..', 'fixtures', 'twitch', 'raid.json'),
  subscription: path.join(__dirname, '..', 'fixtures', 'twitch', 'subscription.json'),
  'subscription-gift': path.join(__dirname, '..', 'fixtures', 'twitch', 'subscription-gift.json')
}

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
  applyFixtureOverrides(event, options)

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

function parseArgs(args) {
  const options = {
    baseUrl: `http://127.0.0.1:${Number(process.env.PORT) || 5000}`,
    count: null,
    eventType: '',
    fixtureFile: '',
    live: false,
    tier: ''
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

function applyFixtureOverrides(event, options) {
  if (Number.isFinite(options.count) && options.count > 0) {
    event.amount = Math.round(options.count)
  }

  if (options.tier) {
    event.tier = options.tier
  }
}

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
  console.log('Usage: npm run simulate:twitch-event -- <follow|raid|sub|gift-sub> [fixture.json] [--count 5] [--tier 1000] [--live] [--url http://127.0.0.1:5000]')
}

function relativePath(file) {
  return path.relative(path.join(__dirname, '..'), file) || file
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseResponseText(text) {
  if (!text) return null

  try {
    const payload = JSON.parse(text)
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch (error) {
    return null
  }
}

function formatHttpError(response, payload, text) {
  const detail = payload.error || summarizeResponseText(text)
  const status = `${response.status} ${response.statusText}`
  return detail ? `${status}: ${detail}` : status
}

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
  formatHttpError,
  parseResponseText,
  simulateLiveEvent,
  summarizeResponseText
}

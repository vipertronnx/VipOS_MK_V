const assert = require('node:assert/strict')
const test = require('node:test')

const {
  applyFixtureOverrides,
  formatHttpError,
  normalizeEventType,
  parseArgs,
  parseResponseText,
  simulateLiveEvent,
  sourceForEvent
} = require('../scripts/simulate-twitch-event')

test('Twitch simulator normalizes chat entries and applies their overrides', () => {
  const event = {
    badges: { moderator: '1', subscriber: '1' },
    chatterId: 'first-user',
    messageId: 'first-message'
  }

  assert.equal(normalizeEventType('chat-entry'), 'chat.entry')
  assert.equal(normalizeEventType('entry'), 'chat.entry')
  assert.equal(sourceForEvent('chat.entry'), 'chat-entry')
  assert.throws(() => parseArgs(['chat-entry', '--role']), /--role requires a value/)
  assert.throws(() => parseArgs(['chat-entry', '--user-id', '--live']), /--user-id requires a value/)

  applyFixtureOverrides(event, { role: 'vip', userId: 'second-user' }, 'chat.entry')

  assert.deepEqual(event, {
    badges: { subscriber: '1', vip: '1' },
    chatterId: 'second-user',
    messageId: 'simulated-chat-entry-second-user'
  })
  assert.throws(
    () => applyFixtureOverrides({}, { role: 'viewer' }, 'chat.entry'),
    /--role must be moderator or vip/
  )
  assert.throws(
    () => applyFixtureOverrides({}, { userId: 'viewer-1' }, 'follow'),
    /only supported for chat-entry simulations/
  )
})

test('live Twitch simulator reports a JSON error response', () => {
  const body = '{"error":"Unknown event type"}'
  const payload = parseResponseText(body)

  assert.equal(
    formatHttpError({ status: 404, statusText: 'Not Found' }, payload, body),
    '404 Not Found: Unknown event type'
  )
})

test('live Twitch simulator reports a non-JSON error response', () => {
  const body = '<html><body>Route not found</body></html>'
  const payload = parseResponseText(body)

  assert.equal(payload, null)
  assert.equal(
    formatHttpError({ status: 404, statusText: 'Not Found' }, payload || {}, body),
    '404 Not Found: <html><body>Route not found</body></html>'
  )
})

test('live Twitch simulator rejects a successful non-JSON response', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    text: async () => '<html><body>Unexpected response</body></html>'
  })

  try {
    await assert.rejects(
      simulateLiveEvent('follow', {}, 'fixtures/twitch/follow.json', 'http://127.0.0.1:8080'),
      /Expected a JSON object response from http:\/\/127\.0\.0\.1:8080\/api\/v1\/twitch\/simulate\/follow/
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('live Twitch simulator submits chat entries to the canonical endpoint', async () => {
  const originalFetch = global.fetch
  const originalLog = console.log
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ options, url })
    return {
      ok: true,
      text: async () => JSON.stringify({ queue: { pending: [], running: null } })
    }
  }
  console.log = () => {}

  try {
    const event = { chatterId: 'vip-1', messageText: 'Hello' }
    await simulateLiveEvent('chat.entry', event, 'fixtures/twitch/chat-entry.json', 'http://127.0.0.1:8080/')

    assert.deepEqual(calls, [{
      options: {
        body: JSON.stringify(event),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST'
      },
      url: 'http://127.0.0.1:8080/api/v1/twitch/simulate/chat.entry'
    }])
  } finally {
    console.log = originalLog
    global.fetch = originalFetch
  }
})

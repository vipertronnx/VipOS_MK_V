const assert = require('node:assert/strict')
const test = require('node:test')

const { createEventSubLifecycle } = require('../modules/chat/chat-eventsub')

class EventSubWsListenerStub {
  constructor({ apiClient }) {
    this.apiClient = apiClient
    this.isActive = false
  }

  onUserSocketConnect(handler) {
    this.socketConnectHandler = handler
  }

  onUserSocketDisconnect(handler) {
    this.socketDisconnectHandler = handler
  }

  onSubscriptionCreateFailure(handler) {
    this.subscriptionFailureHandler = handler
  }

  onSubscriptionCreateSuccess(handler) {
    this.subscriptionSuccessHandler = handler
  }

  onRevoke(handler) {
    this.revokeHandler = handler
  }

  start() {
    this.isActive = true
  }

  stop() {
    this.isActive = false
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

test('EventSub lifecycle owns listener activity, handler groups, and reward retries', async () => {
  const state = {}
  const registrationListeners = []
  const lifecycle = createEventSubLifecycle({
    config: { reconnectInitialMs: 1, reconnectMaxMs: 1 },
    logger: { error() {}, log() {}, warn() {} },
    updateState: nextState => Object.assign(state, nextState)
  })
  const rewardSubscription = {
    id: 'channel.channel_points_custom_reward_redemption.add.channel-123'
  }

  try {
    lifecycle.start({
      apiClient: { name: 'api-client' },
      EventSubWsListener: EventSubWsListenerStub,
      botUserId: 'bot-123',
      broadcasterAuthUserId: 'channel-123',
      registrations: [
        {
          group: 'redemptions',
          register(listener) {
            registrationListeners.push(listener)
            return rewardSubscription
          }
        },
        {
          group: 'raids',
          register(listener) {
            registrationListeners.push(listener)
          }
        }
      ]
    })

    assert.equal(lifecycle.isActive(), true)
    assert.equal(registrationListeners.length, 2)
    assert.deepEqual([...lifecycle.getSubscribedGroups()], ['redemptions', 'raids'])

    registrationListeners[0].subscriptionFailureHandler(rewardSubscription, new Error('subscription failed'))
    assert.equal(state.rewardsLastError, 'subscription failed')
    assert.equal(state.rewardsRetryAttempt, 1)
    await waitFor(() => registrationListeners.length === 3)
    assert.equal(registrationListeners[2], registrationListeners[0])
  } finally {
    lifecycle.stop()
  }

  assert.equal(lifecycle.isActive(), false)
  assert.equal(state.connected, false)
  assert.equal(state.rewardsRetryAttempt, 0)
  assert.equal(state.rewardsNextRetryAt, null)
  assert.deepEqual([...lifecycle.getSubscribedGroups()], ['redemptions', 'raids'])
})

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

test('EventSub lifecycle owns listener activity and registered handler groups', () => {
  const state = {}
  const registrations = []
  const lifecycle = createEventSubLifecycle({
    config: { reconnectInitialMs: 1, reconnectMaxMs: 1 },
    updateState: nextState => Object.assign(state, nextState)
  })

  lifecycle.start({
    apiClient: { name: 'api-client' },
    EventSubWsListener: EventSubWsListenerStub,
    botUserId: 'bot-123',
    broadcasterAuthUserId: 'channel-123',
    registrations: [
      {
        group: 'redemptions',
        reward: true,
        register(listener) {
          registrations.push(listener)
          return { id: 'channel.channel_points_custom_reward_redemption.add.channel-123' }
        }
      },
      {
        group: 'raids',
        register(listener) {
          registrations.push(listener)
        }
      }
    ]
  })

  assert.equal(lifecycle.isActive(), true)
  assert.equal(registrations.length, 2)
  assert.deepEqual([...lifecycle.getSubscribedGroups()], ['redemptions', 'raids'])

  lifecycle.stop()

  assert.equal(lifecycle.isActive(), false)
  assert.equal(state.connected, false)
  assert.equal(state.rewardsRetryAttempt, 0)
  assert.equal(state.rewardsNextRetryAt, null)
  assert.deepEqual([...lifecycle.getSubscribedGroups()], ['redemptions', 'raids'])
})

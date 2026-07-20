const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'news-chyron.js'), 'utf8')

function createElement() {
  const classes = new Set()
  return {
    classList: {
      add(...values) {
        values.forEach(value => classes.add(value))
      },
      contains(value) {
        return classes.has(value)
      },
      remove(...values) {
        values.forEach(value => classes.delete(value))
      }
    },
    textContent: ''
  }
}

function createChyronHarness() {
  const handlers = new Map()
  const elements = new Map([
    ['chyron', createElement()],
    ['chyron-title-text', createElement()],
    ['chyron-headline-text', createElement()],
    ['chyron-subhead-text', createElement()],
    ['chyron-text', createElement()]
  ])
  const timers = new Map()
  let nextTimerId = 1
  const math = Object.create(Math)
  math.random = () => 0
  const window = {
    VIPOS_CHYRON: {
      initialIndex: 0,
      items: [
        { h1: 'Normal one', h2: 'Normal sub one', h3: 'Normal title one' },
        { h1: 'Normal two', h2: 'Normal sub two', h3: 'Normal title two' }
      ],
      rotateIntervalMs: 1000
    },
    VIPOS_SOCKET: {
      on(event, handler) {
        handlers.set(event, handler)
      }
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    requestAnimationFrame(callback) {
      callback()
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++
      timers.set(id, { callback, delay })
      return id
    }
  }

  vm.runInNewContext(source, {
    Math: math,
    document: {
      getElementById(id) {
        return elements.get(id) || null
      }
    },
    window
  })

  return { elements, handlers, timers }
}

test('chyron alert replaces every line and resumes normal rotation', () => {
  const { elements, handlers, timers } = createChyronHarness()

  handlers.get('chyron-alert')({
    h1: 'Follower',
    h2: 'WELCOME ABOARD',
    h3: 'NEW FOLLOWER'
  })

  const alertTransition = [...timers.entries()].find(([, timer]) => timer.delay === 500)
  assert.ok(alertTransition)
  alertTransition[1].callback()
  assert.equal(elements.get('chyron-headline-text').textContent, 'Follower')
  assert.equal(elements.get('chyron-subhead-text').textContent, 'WELCOME ABOARD')
  assert.equal(elements.get('chyron-title-text').textContent, 'NEW FOLLOWER')

  const rotation = [...timers.entries()].find(([, timer]) => timer.delay === 1000)
  assert.ok(rotation)
  rotation[1].callback()

  const normalTransition = [...timers.entries()].find(([, timer]) => timer.delay === 500)
  assert.ok(normalTransition)
  normalTransition[1].callback()
  assert.equal(elements.get('chyron-headline-text').textContent, 'Normal two')
})

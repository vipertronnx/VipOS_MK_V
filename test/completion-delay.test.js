const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createActionQueue } = require('../modules/actions/action-queue')
const { normalizeCompletionDelay } = require('../modules/utils/completion-delay')
const { createMacroService } = require('../modules/utils/macros')

test('completion delays normalize invalid, fractional, and capped values', () => {
  assert.equal(normalizeCompletionDelay(undefined), 0)
  assert.equal(normalizeCompletionDelay('Infinity'), 0)
  assert.equal(normalizeCompletionDelay(-1), 0)
  assert.equal(normalizeCompletionDelay(125.5), 126)
  assert.equal(normalizeCompletionDelay(600001), 600000)
})

test('macro configuration and queue items use the shared completion-delay normalization', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-completion-delay-'))
  const macrosFile = path.join(directory, 'macros.json')

  try {
    fs.writeFileSync(macrosFile, JSON.stringify({
      macros: [{
        id: 'delay-test',
        name: 'Delay Test',
        delayMs: 600001,
        actions: { type: 'log', message: 'test' }
      }]
    }))

    const macros = createMacroService({ macrosFile })
    assert.equal(macros.find('delay-test').completionDelayMs, 600000)

    const actionQueue = createActionQueue({
      actions: { async run() { return [] } }
    })
    actionQueue.pause()
    actionQueue.enqueue({
      actions: { type: 'log', message: 'test' },
      completionDelayMs: 125.5,
      fallbackCompletionDelayMs: 'Infinity'
    })

    const [queuedItem] = actionQueue.getStatus().pending
    assert.equal(queuedItem.completionDelayMs, 126)
    assert.equal(queuedItem.fallbackCompletionDelayMs, 0)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createGreetingService,
  DEFAULT_GREETINGS_EXAMPLE_FILE
} = require('../modules/actions/greetings')
const {
  createMacroService,
  DEFAULT_MACROS_EXAMPLE_FILE
} = require('../modules/actions/macros')

test('tracked macro and greeting examples load through their services', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-config-services-'))

  try {
    assert.equal(fs.existsSync(DEFAULT_MACROS_EXAMPLE_FILE), true)
    assert.equal(fs.existsSync(DEFAULT_GREETINGS_EXAMPLE_FILE), true)

    const macros = createMacroService({ macrosFile: DEFAULT_MACROS_EXAMPLE_FILE }).list()
    const greetings = createGreetingService({
      greetingsFile: DEFAULT_GREETINGS_EXAMPLE_FILE,
      settingsFile: path.join(directory, 'greetings-settings.json')
    }).getStatus()

    assert.ok(macros.length > 0)
    assert.ok(greetings.activePool)
    assert.ok(greetings.pools.length > 0)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

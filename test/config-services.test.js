const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createGreetingService,
  DEFAULT_GREETINGS_EXAMPLE_FILE,
  getCatalogExampleFile
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

test('welcome-follower catalog resolves to its tracked example when the local file is absent', () => {
  const localCatalog = path.join(__dirname, '..', 'config', 'welcome-followers.json')
  const expectedExample = path.join(__dirname, '..', 'config', 'examples', 'welcome-followers.example.json')

  assert.equal(getCatalogExampleFile(localCatalog), expectedExample)
  assert.equal(fs.existsSync(expectedExample), true)
})

test('missing welcome-follower catalog loads its tracked example values', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-welcome-followers-'))
  const localCatalog = path.join(directory, 'welcome-followers.json')
  const exampleCatalog = path.join(directory, 'welcome-followers.example.json')
  fs.writeFileSync(exampleCatalog, JSON.stringify(['WELCOME ABOARD']))

  try {
    const greetings = createGreetingService({
      catalogExampleFileResolver(file) {
        return file === localCatalog ? exampleCatalog : null
      },
      greetingsFile: localCatalog,
      logger: { warn() {} },
      settingsFile: path.join(directory, 'greetings-settings.json')
    })

    assert.deepEqual(greetings.pick(), {
      pool: 'all',
      value: 'WELCOME ABOARD'
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

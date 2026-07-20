const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { checkDocumentation } = require('../scripts/check-docs')

test('documentation checks accept valid links, fences, and environment coverage', t => {
  const projectRoot = createProjectFixture(t)

  const result = checkDocumentation({ projectRoot })

  assert.deepEqual(result.errors, [])
  assert.equal(result.markdownFiles.length, 3)
})

test('documentation checks report missing local links and anchors', t => {
  const projectRoot = createProjectFixture(t, {
    readme: [
      '# Fixture',
      '',
      '[Missing file](docs/missing.md)',
      '[Missing anchor](docs/configuration.md#missing-section)'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.includes('README.md links to missing file docs/missing.md'))
  assert.ok(errors.includes('README.md links to missing anchor #missing-section in docs/configuration.md'))
})

test('documentation checks report unmatched fenced code blocks', t => {
  const projectRoot = createProjectFixture(t, {
    standards: '# Standards\n\n```text\nunclosed\n'
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.includes('ENGINEERING_STANDARDS.md has an unmatched fenced code block'))
})

test('documentation checks report environment variables missing from the reference', t => {
  const projectRoot = createProjectFixture(t, {
    app: 'const value = process.env.UNDOCUMENTED_VALUE\nmodule.exports = value\n'
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.includes('UNDOCUMENTED_VALUE is read by application code but absent from .env.example and docs/configuration.md'))
})

test('documentation checks report JSDoc parameter names that do not match a function signature', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/**',
      ' * @param {string} message Text to return.',
      ' * @returns {string} The supplied text.',
      ' */',
      'function echo(value) {',
      '  return value',
      '}',
      'module.exports = echo'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('echo documents parameter message but declares value')))
})

test('documentation checks report missing parameter tags on documented functions', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/**',
      ' * @returns {string} The supplied text.',
      ' */',
      'function echo(value) {',
      '  return value',
      '}',
      'module.exports = echo'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('echo documents 0 parameters but declares 1')))
})

test('documentation checks report unknown properties documented for destructured parameters', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/**',
      ' * @param {object} options Configuration values.',
      ' * @param {boolean} options.enabled Whether the feature is enabled.',
      ' * @param {string} options.missing Unsupported setting.',
      ' * @returns {boolean} Current enabled state.',
      ' */',
      'function configure({ enabled }) {',
      '  return enabled',
      '}',
      'module.exports = configure'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('configure documents unknown destructured parameter options.missing')))
})

test('documentation checks require Promise return types for async functions', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/**',
      ' * @returns {string} Loaded value.',
      ' */',
      'async function load() {',
      "  return 'ready'",
      '}',
      'module.exports = load'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('load is async but its @returns type is not Promise-like')))
})

test('documentation checks require return documentation for documented value-returning functions', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/**',
      ' * @param {string} value Value to normalize.',
      ' */',
      'function normalize(value) {',
      '  return value.trim()',
      '}',
      'module.exports = normalize'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('normalize returns a value but has no @returns tag')))
})

test('documentation checks report incompatible documented return shapes', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/**',
      ' * @returns {{count: string}} Count summary.',
      ' */',
      'function summarize() {',
      '  return { count: 1 }',
      '}',
      'module.exports = summarize'
    ].join('\n')
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('summarize returns { count: number; } but its @returns type is { count: string; }')))
})

test('documentation checks report incompatible imported return contracts', t => {
  const projectRoot = createProjectFixture(t, {
    app: [
      '/** @typedef {import(\'./types/contracts\').Summary} Summary */',
      '/**',
      ' * @returns {Summary} Count summary.',
      ' */',
      'function summarize() {',
      '  return { count: 1 }',
      '}',
      'module.exports = summarize'
    ].join('\n'),
    contracts: 'export interface Summary { count: string }\n'
  })

  const { errors } = checkDocumentation({ projectRoot })

  assert.ok(errors.some(error => error.includes('summarize returns { count: number; } but its @returns type is Summary')))
})

function createProjectFixture(t, overrides = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vipos-docs-'))
  t.after(() => fs.rmSync(projectRoot, { force: true, recursive: true }))

  write(projectRoot, 'README.md', overrides.readme || '# Fixture\n\n[Configuration](docs/configuration.md#configuration)\n')
  write(projectRoot, 'ENGINEERING_STANDARDS.md', overrides.standards || '# Standards\n\n```text\nclosed\n```\n')
  write(projectRoot, 'docs/configuration.md', '# Configuration\n\n`DOCUMENTED_VALUE` is configured here.\n')
  write(projectRoot, '.env.example', 'DOCUMENTED_VALUE=example\n')
  write(projectRoot, 'app.js', overrides.app || 'const value = process.env.DOCUMENTED_VALUE\nmodule.exports = value\n')
  fs.mkdirSync(path.join(projectRoot, 'modules'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true })
  if (overrides.contracts) write(projectRoot, 'types/contracts.d.ts', overrides.contracts)

  return projectRoot
}

function write(projectRoot, relativePath, content) {
  const file = path.join(projectRoot, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

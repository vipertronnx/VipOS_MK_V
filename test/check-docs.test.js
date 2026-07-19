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

  return projectRoot
}

function write(projectRoot, relativePath, content) {
  const file = path.join(projectRoot, relativePath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

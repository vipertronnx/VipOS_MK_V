const fs = require('fs')
const path = require('path')

const defaultProjectRoot = path.resolve(__dirname, '..')

function checkDocumentation({ projectRoot = defaultProjectRoot } = {}) {
  const markdownFiles = [
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'ENGINEERING_STANDARDS.md'),
    ...findFiles(path.join(projectRoot, 'docs'), file => file.endsWith('.md'))
  ]
  const errors = []

  for (const file of markdownFiles) {
    const content = fs.readFileSync(file, 'utf8')
    checkCodeFences(file, content, errors, projectRoot)
    checkLocalLinks(file, content, errors, projectRoot)
  }

  checkEnvironmentDocumentation(projectRoot, errors)
  return { errors, markdownFiles }
}

function main() {
  const { errors, markdownFiles } = checkDocumentation()

  if (errors.length) {
    console.error(`Documentation checks failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`Documentation checks passed for ${markdownFiles.length} Markdown files.`)
  }
}

function findFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return []

  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? findFiles(entryPath, predicate) : [entryPath]
    })
    .filter(predicate)
}

function checkCodeFences(file, content, errors, projectRoot) {
  const fences = content.split(/\r?\n/).filter(line => /^\s*```/.test(line))
  if (fences.length % 2 !== 0) {
    errors.push(`${relative(file, projectRoot)} has an unmatched fenced code block`)
  }
}

function checkLocalLinks(file, content, errors, projectRoot) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g
  let match

  while ((match = linkPattern.exec(content))) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '')
    if (!rawTarget || /^[a-z][a-z+.-]*:/i.test(rawTarget)) continue

    const [rawPath, rawAnchor] = rawTarget.split('#', 2)
    const targetFile = rawPath
      ? path.resolve(path.dirname(file), decodeURIComponent(rawPath))
      : file

    if (!fs.existsSync(targetFile)) {
      errors.push(`${relative(file, projectRoot)} links to missing file ${rawPath}`)
      continue
    }

    if (rawAnchor && path.extname(targetFile).toLowerCase() === '.md') {
      const anchors = getMarkdownAnchors(fs.readFileSync(targetFile, 'utf8'))
      const anchor = decodeURIComponent(rawAnchor).toLowerCase()
      if (!anchors.has(anchor)) {
        errors.push(`${relative(file, projectRoot)} links to missing anchor #${rawAnchor} in ${relative(targetFile, projectRoot)}`)
      }
    }
  }
}

function getMarkdownAnchors(content) {
  const anchors = new Set()
  const counts = new Map()

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (!match) continue

    const base = match[1]
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')

    const count = counts.get(base) || 0
    anchors.add(count ? `${base}-${count}` : base)
    counts.set(base, count + 1)
  }

  return anchors
}

function checkEnvironmentDocumentation(projectRoot, errors) {
  const sourceFiles = [
    path.join(projectRoot, 'app.js'),
    ...findFiles(path.join(projectRoot, 'modules'), file => file.endsWith('.js')),
    ...findFiles(path.join(projectRoot, 'scripts'), file => file.endsWith('.js'))
  ]
  const usedVariables = new Set()
  const variablePattern = /\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*)\b/g

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8')
    let match
    while ((match = variablePattern.exec(content))) usedVariables.add(match[1])
  }

  const reference = [
    fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8'),
    fs.readFileSync(path.join(projectRoot, 'docs', 'configuration.md'), 'utf8')
  ].join('\n')

  for (const variable of [...usedVariables].sort()) {
    if (!new RegExp(`\\b${variable}\\b`).test(reference)) {
      errors.push(`${variable} is read by application code but absent from .env.example and docs/configuration.md`)
    }
  }
}

function relative(file, projectRoot) {
  return path.relative(projectRoot, file).replace(/\\/g, '/')
}

if (require.main === module) main()

module.exports = {
  checkDocumentation
}

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const defaultProjectRoot = path.resolve(__dirname, '..')

/**
 * Validates repository Markdown structure, local links, and documented environment variables.
 *
 * @param {object} [options] Documentation check configuration.
 * @param {string} [options.projectRoot] Repository root containing docs and environment references.
 * @returns {{errors: string[], markdownFiles: string[]}} Checked Markdown files and all detected failures.
 * @throws {Error} Throws when required repository files cannot be read or a local link contains invalid percent encoding.
 */
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
  checkJSDocSignatures(projectRoot, errors)
  checkJSDocReturnTypes(projectRoot, errors)
  return { errors, markdownFiles }
}

function main() {
  const { errors, markdownFiles } = checkDocumentation()

  if (errors.length) {
    console.error(`Documentation checks failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log(`Documentation checks passed for ${markdownFiles.length} Markdown files and ${findJavaScriptFiles(defaultProjectRoot).length} JavaScript files.`)
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
  const sourceFiles = findJavaScriptFiles(projectRoot)
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

/**
 * Checks that JSDoc tags attached to functions remain synchronized with their JavaScript signatures.
 *
 * @param {string} projectRoot Repository root containing application source files.
 * @param {string[]} errors Mutable collection of detected documentation failures.
 * @returns {void}
 */
function checkJSDocSignatures(projectRoot, errors) {
  for (const file of findJavaScriptFiles(projectRoot)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    )

    visitJSDocFunctions(source, source, file, projectRoot, errors)
  }
}

function checkJSDocReturnTypes(projectRoot, errors) {
  const sourceFiles = findJavaScriptFiles(projectRoot)
  const typeFiles = findFiles(path.join(projectRoot, 'types'), file => file.endsWith('.d.ts'))
  const program = ts.createProgram([...sourceFiles, ...typeFiles], {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022
  })
  const checker = program.getTypeChecker()

  for (const file of sourceFiles) {
    const source = program.getSourceFile(file)
    if (source) visitReturnTypes(source, source, file, projectRoot, checker, errors)
  }
}

function visitReturnTypes(node, source, file, projectRoot, checker, errors) {
  if (isDocumentableFunction(node)) checkFunctionReturnTypes(node, source, file, projectRoot, checker, errors)
  ts.forEachChild(node, child => visitReturnTypes(child, source, file, projectRoot, checker, errors))
}

function checkFunctionReturnTypes(node, source, file, projectRoot, checker, errors) {
  const returnTag = getDirectJSDocTags(node).find(tag => tag.tagName.text === 'returns' || tag.tagName.text === 'return')
  if (!returnTag || !returnTag.typeExpression) return

  const documentedType = returnTag.typeExpression.type
  const expectedTypeNode = isAsyncFunction(node) ? getPromiseValueTypeNode(documentedType) : documentedType
  if (!expectedTypeNode || !isStaticallyComparableType(expectedTypeNode)) return

  const expectedType = checker.getTypeFromTypeNode(expectedTypeNode)
  for (const expression of getReturnExpressions(node)) {
    const actualType = checker.getTypeAtLocation(expression)
    if (isUncheckedType(actualType) || checker.isTypeAssignableTo(actualType, expectedType)) continue

    addJSDocError(
      errors,
      file,
      projectRoot,
      expression,
      source,
      `${getFunctionName(node, source)} returns ${checker.typeToString(actualType)} but its @returns type is ${checker.typeToString(expectedType)}`
    )
  }
}

function getDirectJSDocTags(node) {
  return (node.jsDoc || []).flatMap(comment => comment.tags ? [...comment.tags] : [])
}

function getPromiseValueTypeNode(typeNode) {
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) return null
  if (!['Promise', 'PromiseLike'].includes(typeNode.typeName.text)) return null
  return typeNode.typeArguments && typeNode.typeArguments[0]
}

function isStaticallyComparableType(typeNode) {
  if (ts.isTypeReferenceNode(typeNode)) {
    if (ts.isIdentifier(typeNode.typeName) && typeNode.typeName.text === 'Record') return false
    return !typeNode.typeArguments || [...typeNode.typeArguments].every(isStaticallyComparableType)
  }

  if (ts.isArrayTypeNode(typeNode) || ts.isParenthesizedTypeNode(typeNode)) return isStaticallyComparableType(typeNode.elementType || typeNode.type)
  if (ts.isIntersectionTypeNode(typeNode)) return false
  if (ts.isUnionTypeNode(typeNode)) return typeNode.types.every(isStaticallyComparableType)
  if (ts.isTypeLiteralNode(typeNode)) {
    return typeNode.members.every(member => !member.type || isStaticallyComparableType(member.type))
  }

  return ts.isLiteralTypeNode(typeNode) ||
    typeNode.kind === ts.SyntaxKind.StringKeyword ||
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BooleanKeyword ||
    typeNode.kind === ts.SyntaxKind.ObjectKeyword ||
    typeNode.kind === ts.SyntaxKind.VoidKeyword ||
    typeNode.kind === ts.SyntaxKind.NullKeyword ||
    typeNode.kind === ts.SyntaxKind.UndefinedKeyword
}

function getReturnExpressions(functionNode) {
  const expressions = []

  function visit(node) {
    if (node !== functionNode && isDocumentableFunction(node)) return
    if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression)
    ts.forEachChild(node, visit)
  }

  visit(functionNode.body)
  return expressions
}

function isUncheckedType(type) {
  return Boolean(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
}

function visitJSDocFunctions(node, source, file, projectRoot, errors) {
  if (isDocumentableFunction(node)) {
    const tags = getAllJSDocTags(node)
    if (tags.length) checkFunctionJSDoc(node, tags, source, file, projectRoot, errors)
  }

  ts.forEachChild(node, child => visitJSDocFunctions(child, source, file, projectRoot, errors))
}

function getAllJSDocTags(node) {
  const tags = [...ts.getJSDocTags(node)]

  for (const tag of tags) {
    const propertyTags = tag.typeExpression && tag.typeExpression.type.jsDocPropertyTags
    if (propertyTags) tags.push(...propertyTags)
  }

  return tags
}

function isDocumentableFunction(node) {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
}

function checkFunctionJSDoc(node, tags, source, file, projectRoot, errors) {
  const parameterTags = tags.filter(tag => tag.tagName.text === 'param')
  const rootParameterTags = parameterTags.filter(tag => !getTagName(tag, source).includes('.'))
  const returnTags = tags.filter(tag => tag.tagName.text === 'returns' || tag.tagName.text === 'return')
  const functionName = getFunctionName(node, source)

  if (node.parameters.length) {
    checkParameterTags(node, parameterTags, rootParameterTags, source, file, projectRoot, functionName, errors)
  }

  if (returnTags.length > 1) {
    addJSDocError(errors, file, projectRoot, node, source, `${functionName} has multiple @returns tags`)
  }

  const hasValueReturn = hasValueReturnStatement(node)
  if (hasValueReturn && !returnTags.length) {
    addJSDocError(errors, file, projectRoot, node, source, `${functionName} returns a value but has no @returns tag`)
  }

  if (!hasValueReturn && returnTags.length && !isVoidReturnType(getReturnTypeText(returnTags[0], source))) {
    addJSDocError(errors, file, projectRoot, node, source, `${functionName} has a non-void @returns tag but does not return a value`)
  }

  if (isAsyncFunction(node) && returnTags.length && !isPromiseType(getReturnTypeText(returnTags[0], source))) {
    addJSDocError(errors, file, projectRoot, node, source, `${functionName} is async but its @returns type is not Promise-like`)
  }
}

function checkParameterTags(node, parameterTags, rootParameterTags, source, file, projectRoot, functionName, errors) {
  if (rootParameterTags.length !== node.parameters.length) {
    addJSDocError(
      errors,
      file,
      projectRoot,
      node,
      source,
      `${functionName} documents ${rootParameterTags.length} parameter${rootParameterTags.length === 1 ? '' : 's'} but declares ${node.parameters.length}`
    )
    return
  }

  const rootNames = new Set(rootParameterTags.map(tag => getTagName(tag, source)))

  for (const [index, parameter] of node.parameters.entries()) {
    const tagName = getTagName(rootParameterTags[index], source)
    if (ts.isIdentifier(parameter.name) && parameter.name.text !== tagName) {
      addJSDocError(errors, file, projectRoot, parameter, source, `${functionName} documents parameter ${tagName} but declares ${parameter.name.text}`)
    }

    if (!ts.isObjectBindingPattern(parameter.name)) continue
    const properties = new Set(getBindingPropertyNames(parameter.name))
    for (const tag of parameterTags) {
      const nestedName = getTagName(tag, source)
      if (!nestedName.startsWith(`${tagName}.`)) continue
      const property = nestedName.slice(tagName.length + 1).split('.')[0]
      if (!properties.has(property)) {
        addJSDocError(errors, file, projectRoot, tag, source, `${functionName} documents unknown destructured parameter ${nestedName}`)
      }
    }
  }

  for (const tag of parameterTags) {
    const tagName = getTagName(tag, source)
    const rootName = tagName.split('.')[0]
    if (!rootNames.has(rootName)) {
      addJSDocError(errors, file, projectRoot, tag, source, `${functionName} documents parameter ${tagName} without a matching root parameter`)
    }
  }
}

function getBindingPropertyNames(pattern) {
  return pattern.elements
    .filter(element => ts.isBindingElement(element) && !element.dotDotDotToken)
    .map(element => {
      if (element.propertyName && ts.isIdentifier(element.propertyName)) return element.propertyName.text
      return ts.isIdentifier(element.name) ? element.name.text : ''
    })
    .filter(Boolean)
}

function getTagName(tag, source) {
  return tag.name ? tag.name.getText(source).replace(/^\[|\]$/g, '') : ''
}

function getReturnTypeText(tag, source) {
  return tag.typeExpression ? tag.typeExpression.type.getText(source).trim() : ''
}

function isPromiseType(typeText) {
  return /^(?:Promise|PromiseLike)\s*(?:<|$)/.test(typeText)
}

function isVoidReturnType(typeText) {
  return typeText === 'void' || /^(?:Promise|PromiseLike)\s*<\s*void\s*>$/.test(typeText)
}

function isAsyncFunction(node) {
  return Boolean(node.modifiers && node.modifiers.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))
}

function hasValueReturnStatement(functionNode) {
  let hasValueReturn = false

  function visit(node) {
    if (node !== functionNode && isDocumentableFunction(node)) return
    if (ts.isReturnStatement(node) && node.expression) {
      hasValueReturn = true
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(functionNode.body)
  return hasValueReturn
}

function getFunctionName(node, source) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  return `anonymous function at line ${line}`
}

function addJSDocError(errors, file, projectRoot, node, source, message) {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  errors.push(`${relative(file, projectRoot)}:${line} ${message}`)
}

function findJavaScriptFiles(projectRoot) {
  return [
    path.join(projectRoot, 'app.js'),
    ...findFiles(path.join(projectRoot, 'modules'), file => file.endsWith('.js')),
    ...findFiles(path.join(projectRoot, 'scripts'), file => file.endsWith('.js'))
  ].filter(file => fs.existsSync(file))
}

function relative(file, projectRoot) {
  return path.relative(projectRoot, file).replace(/\\/g, '/')
}

if (require.main === module) main()

module.exports = {
  checkDocumentation
}

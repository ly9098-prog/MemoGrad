const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const ts = createRequire(path.resolve(__dirname, '../../../admin-frontend/package.json'))('typescript')

function inspectPackageDependencies(source, filename, appConfig) {
  const packages = appConfig.subPackages || appConfig.subpackages || []
  const roots = packages.map(item => item.root.replace(/\/$/, ''))
  const owner = name => roots.find(root => name.startsWith(root + '/')) || ''
  const sourceOwner = owner(filename)
  const independent = packages.some(item => item.root === sourceOwner && item.independent)
  const errors = []
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  function checkDependency(specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return
    const target = specifier.startsWith('/') ? path.posix.normalize(specifier.slice(1))
      : path.posix.join(path.posix.dirname(filename), specifier)
    const targetOwner = owner(target)
    if ((targetOwner && targetOwner !== sourceOwner) || (independent && !targetOwner)) {
      errors.push(`${filename}: forbidden package dependency ${specifier}`)
    }
  }
  function walk(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      checkDependency(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' && node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0])) {
      checkDependency(node.arguments[0].text)
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  return errors
}

function checkPackageDependencies(root, appConfig, ignored) {
  const errors = []
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      const relative = path.relative(root, filename).split(path.sep).join('/')
      if (ignored(relative)) continue
      if (entry.isDirectory()) walk(filename)
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        errors.push(...inspectPackageDependencies(fs.readFileSync(filename, 'utf8'), relative, appConfig))
      }
    }
  }
  walk(root)
  return errors
}

module.exports = { inspectPackageDependencies, checkPackageDependencies }

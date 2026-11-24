/**
 * Packaging-rule and prebuilt-vendor regression checks.
 * Run: cd miniprogram && node tests/test-package-quality.js
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { matchesPackIgnore, collectPackageSizes, checkBudgets } = require('./test-main-package-size')
const { inspectPackageDependencies, checkPackageDependencies } = require('../scripts/architecture/package-dependencies')

assert.equal(matchesPackIgnore('tests/a.js', { type: 'folder', value: 'tests' }), true)
assert.equal(matchesPackIgnore('tests-extra/a.js', { type: 'folder', value: 'tests' }), false)
assert.equal(matchesPackIgnore('a.test.js', { type: 'glob', value: '**/*.test.js' }), true)
assert.equal(matchesPackIgnore('nested/a.test.js', { type: 'glob', value: '**/*.test.js' }), true)
assert.equal(matchesPackIgnore('nested/a.js', { type: 'glob', value: '**/*.test.js' }), false)
assert.equal(matchesPackIgnore('assets/a.png', { type: 'glob', value: 'assets/*.png' }), true)
assert.equal(matchesPackIgnore('assets/nested/a.png', { type: 'glob', value: 'assets/*.png' }), false)
assert.equal(matchesPackIgnore('notes.md', { type: 'suffix', value: '.md' }), true)
assert.equal(matchesPackIgnore('assets/a.png', { type: 'file', value: 'assets/a.png' }), true)
assert.equal(matchesPackIgnore('assets/b.png', { type: 'file', value: 'assets/a.png' }), false)
assert.throws(() => matchesPackIgnore('x', { type: 'unknown', value: 'x' }), /Unsupported/)

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'miniprogram-package-quality-'))
try {
  function write(name, bytes) {
    const file = path.join(fixture, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.alloc(bytes))
  }
  write('app.js', 10)
  write('assets/a.png', 80 * 1024)
  write('subpackages/study/b.png', 120 * 1024)
  write('tests/ignored.png', 300 * 1024)
  write('subpackages/study/unused.png', 300 * 1024)
  const appConfig = { subPackages: [{ root: 'subpackages/study' }] }
  const projectConfig = { packOptions: { ignore: [
    { type: 'folder', value: 'tests' },
    { type: 'glob', value: 'subpackages/study/unused.png' },
  ] } }
  const summary = collectPackageSizes(fixture, appConfig, projectConfig)
  assert.equal(summary.packages.__APP__.bytes, 10 + 80 * 1024)
  assert.equal(summary.packages['subpackages/study'].bytes, 120 * 1024)
  assert.equal(summary.mediaBytes, 200 * 1024, 'media must be summed across packages')
  assert.equal(summary.media.length, 2, 'explicitly excluded media must not be counted')
  assert.throws(() => checkBudgets(summary), /Aggregate media budget exceeded/)
  assert.throws(() => checkBudgets({ packages: { __APP__: { bytes: 2 * 1024 * 1024 } }, media: [], mediaBytes: 0 }), /Source package budget/)
  // Synthetic value stays above the current study ceiling (1.5 MiB).
  assert.throws(() => checkBudgets({ packages: { 'subpackages/study': { bytes: 1.6 * 1024 * 1024 } }, media: [], mediaBytes: 0 }), /Source package budget/)
  assert.throws(() => collectPackageSizes(fixture, appConfig, { packOptions: { include: [{ type: 'file', value: 'app.js' }] } }), /include rules/)
} finally {
  // Only delete the temporary fixture created by this test.
  fs.rmSync(fixture, { recursive: true })
}

const miniRoot = path.resolve(__dirname, '..')
const readJson = name => JSON.parse(fs.readFileSync(path.join(miniRoot, name), 'utf8'))
const config = readJson('project.config.json')
const vendorPrefix = 'subpackages/study/components/mp-html/latex/'
const vendorFiles = [
  'katex-core.js', 'katex-part-150.js', 'katex-part-187.js',
  'katex-part-64.js', 'katex-part-970.js', 'katex.min.js',
]
assert.deepEqual(config.setting.babelSetting.ignore, vendorFiles.map(file => vendorPrefix + file),
  'skip Babel only for the six prebuilt study vendors to prevent compiled-package expansion')
for (const file of vendorFiles) {
  const relative = vendorPrefix + file
  assert.equal(fs.existsSync(path.join(miniRoot, relative)), true,
    'Babel exclusions must point to existing local vendor files: ' + relative)
  assert.equal(config.packOptions.ignore.some(rule => matchesPackIgnore(relative, rule)), false,
    'skip vendor transpilation without excluding required code from the package: ' + relative)
  assert.equal(fs.existsSync(path.join(miniRoot, 'vendor/katex', file)), false,
    'do not restore unused main-package KaTeX vendors: ' + file)
}
assert.equal(config.setting.es6, true, 'business code still needs ES6 compilation')
assert.equal(config.setting.enhance, true, 'business code still needs enhanced compilation')
assert.equal(config.setting.minified, true)
assert.equal(config.setting.ignoreCodeQuality, undefined, 'quality checks must not be bypassed')
// Every subpackage vendor copy, including the Babel exclusions, must satisfy upload grammar.
require('./test-katex-upload-syntax')
const app = readJson('app.json')
const boundaryConfig = { subPackages: [
  { root: 'subpackages/study' }, { root: 'subpackages/exam' },
  { root: 'subpackages/independent', independent: true },
] }
for (const source of [
  "require('../../study/utils/ai-teacher-request')",
  "require('/subpackages/study/utils/ai-teacher-408')",
  "import helper from '../../study/utils/ai-teacher-408'",
  "export { helper } from '../../study/utils/ai-teacher-408'",
]) {
  assert.equal(inspectPackageDependencies(source, 'subpackages/exam/result/index.js', boundaryConfig).length, 1)
}
assert.equal(inspectPackageDependencies("require('../utils/local')", 'subpackages/exam/result/index.js', boundaryConfig).length, 0)
assert.equal(inspectPackageDependencies("require('../../../utils/shared')", 'subpackages/exam/result/index.js', boundaryConfig).length, 0)
assert.equal(inspectPackageDependencies("require('./subpackages/exam/utils/local')", 'app.js', boundaryConfig).length, 1)
assert.equal(inspectPackageDependencies("require('../../utils/shared')", 'subpackages/independent/index.js', boundaryConfig).length, 1)
assert.deepEqual(checkPackageDependencies(miniRoot, app, relative =>
  (config.packOptions.ignore || []).some(rule => matchesPackIgnore(relative, rule))), [])
assert.equal(app.usingComponents['app-dialog'], '/components/app-dialog/index')
assert.equal(app.usingComponents['premium-nav'], '/components/premium-nav/premium-nav')
const routeTeacherRequest = path.join(miniRoot, 'utils/ai-teacher-request.js')
assert.equal(fs.existsSync(routeTeacherRequest), true,
  'study and exam must share the teacher request helper through the main package')
assert.equal(
  fs.existsSync(path.join(miniRoot, 'subpackages/study/utils/ai-teacher-request.js')),
  false,
  'do not retain a second teacher request implementation inside study',
)
const mainRequire = createRequire(path.join(miniRoot, 'app.js'))
const mainLoads = []
let appDefinition
const requestArgs = []
vm.runInNewContext(fs.readFileSync(path.join(miniRoot, 'app.js'), 'utf8'), {
  App: definition => { appDefinition = definition },
  require: specifier => {
    mainLoads.push(specifier)
    if (specifier === './utils/ai-teacher-request') return {
      requestTeacher: (...args) => { requestArgs.push(args); return 'lesson' },
    }
    return mainRequire(specifier)
  },
})
assert.equal(mainLoads.includes('./utils/ai-teacher-408'), false,
  'shared teacher code must not load during application startup')
const teacher = appDefinition.getAiTeacher()
assert.equal(teacher.normalizeResult, mainRequire('./utils/ai-teacher-408').normalizeResult)
assert.equal(teacher.presentTeacherResult, mainRequire('./utils/teacher-presentation').presentTeacherResult)
assert.equal(mainLoads.includes('./utils/ai-teacher-request'), false,
  'opening a result page must not load the AI request module')
const teacherArgs = [{ post() {} }, { question_id: 7 }, { timeout: 55000 }]
assert.equal(appDefinition.requestAiTeacher(...teacherArgs), 'lesson')
assert.deepEqual(requestArgs, [teacherArgs])
for (const helper of ['ai-teacher-408', 'teacher-presentation', 'ai-teacher-request']) {
  assert.ok(mainLoads.includes('./utils/' + helper), helper + ' must be reachable from the App service')
}
checkBudgets(collectPackageSizes(miniRoot, app, config))
console.log('Package quality regression checks passed')

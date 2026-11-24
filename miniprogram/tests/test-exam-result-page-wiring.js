const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../subpackages/exam/result/index.js'),
  'utf8'
)

function method(name) {
  const start = pageSource.indexOf(`  _${name}() {`)
  assert.ok(start >= 0, `missing _${name}`)
  const end = pageSource.indexOf('\n  },', start)
  return pageSource.slice(start, end)
}

test('loadResult delegates to the exam result load controller', () => {
  const start = pageSource.indexOf('  async loadResult(options = {}) {')
  assert.ok(start >= 0, 'missing loadResult')
  const end = pageSource.indexOf('\n  },', start)
  const source = pageSource.slice(start, end)
  assert.ok(source.includes('return this._examResultLoadController().load(options)'))
  assert.ok(source.split('\n').length <= 5)
})

test('exam result load wiring exposes the exact controller port set', () => {
  const source = method('examResultLoadController')
  const expectedPorts = [
    'getInflight',
    'setInflight',
    'nextSequence',
    'getSequence',
    'isPageAlive',
    'setData',
    'fetchResult',
    'getErrorMessage',
    'percentNumber',
    'clamp',
    'compactScore',
    'compactDuration',
    'encouragement',
    'encouragementTail',
    'buildKnowledgeMetrics',
    'buildScoreRing',
    'buildRadar',
    'buildTopItems',
    'collectWrongIds',
    'firstWrongIdByQuestion',
    'setWrongIds',
    'getWrongIdsLength',
    'resetDiagnosisIndex',
    'setDiagnosisId',
    'setFirstQuestionId',
  ]
  for (const port of expectedPorts) {
    // Ports may be wired as `port:` (arrow/long form) or `port,` (shorthand).
    assert.ok(
      source.includes(`${port}:`) || source.includes(`${port},`),
      `missing port wiring: ${port}`
    )
  }
  // Match both `port:` and `port,` shorthand forms at 8-space indent.
  const portMatches = source.match(/^\s{8}([A-Za-z]\w*)(?:[:,])/gm) || []
  const actualPorts = portMatches.map(match => match.trim().replace(/[:,]/, ''))
  assert.deepEqual([...actualPorts].sort(), [...expectedPorts].sort())
})

test('exam result load ports are wired to exact page helpers', () => {
  const source = method('examResultLoadController')
  assert.ok(source.includes("api.get(`/exams/attempts/${this.data.attemptId}/result`)"))
  assert.ok(source.includes('api.getErrorMessage(error)'))
  assert.ok(source.includes('this._wrongIds = ids'))
  assert.ok(source.includes('this._wrongIds.length'))
  assert.ok(source.includes('this._diagnosisIdByWrongId = Object.create(null)'))
  assert.ok(source.includes('this._diagnosisIdByWrongId[wrongId] = diagnosisId'))
  assert.ok(source.includes('this._firstQuestionId = id'))
})

test('exam result load cached field name is stable', () => {
  const source = method('examResultLoadController')
  assert.ok(source.includes('if (!this._examResultLoad)'))
  assert.ok(source.includes('this._examResultLoad = createExamResultLoadController'))
  assert.ok(source.includes('return this._examResultLoad'))
})

test('run408Teacher delegates to the exam 408 teacher controller', () => {
  const start = pageSource.indexOf('  async run408Teacher(action, questionId = this._firstQuestionId) {')
  assert.ok(start >= 0, 'missing run408Teacher')
  const end = pageSource.indexOf('\n  },', start)
  const source = pageSource.slice(start, end)
  assert.ok(source.includes('return this._exam408TeacherController().run(action, questionId)'))
  assert.ok(source.split('\n').length <= 4)
})

test('exam 408 teacher wiring exposes the exact controller port set', () => {
  const source = method('exam408TeacherController')
  const expectedPorts = [
    'getAttemptId',
    'getTeacherLoading',
    'isPageAlive',
    'setData',
    'getCacheEntry',
    'setCacheEntry',
    'getInflight',
    'setInflight',
    'deleteInflight',
    'nextRequestSequence',
    'getRequestSequence',
    'postTeacher',
    'normalizeResult',
    'errorMessage',
  ]
  for (const port of expectedPorts) {
    assert.ok(source.includes(`${port}:`), `missing port wiring: ${port}`)
  }
  const portMatches = source.match(/^\s{8}([A-Za-z]\w*):/gm) || []
  const actualPorts = portMatches.map(match => match.trim().replace(':', ''))
  assert.deepEqual([...actualPorts].sort(), [...expectedPorts].sort())
})

test('exam 408 teacher ports are wired to exact page helpers', () => {
  const source = method('exam408TeacherController')
  assert.ok(source.includes('requestTeacher(api, payload, {'))
  assert.ok(source.includes('this._teacherRequestSeq === sequence'))
  assert.ok(source.includes('Number(this.data.attemptId) === Number(payload.exam_attempt_id)'))
  assert.ok(source.includes('presentTeacherResult(aiTeacher408.normalizeResult(raw))'))
  assert.ok(source.includes('aiTeacher408.errorMessage(error, api)'))
  assert.ok(source.includes('this._teacherCache[key]'))
  assert.ok(source.includes('this._teacherInflight[key]'))
  assert.ok(source.includes('delete this._teacherInflight[key]'))
  assert.ok(source.includes('++this._teacherRequestSeq'))
})

test('exam 408 teacher cached field name is stable', () => {
  const source = method('exam408TeacherController')
  assert.ok(source.includes('if (!this._exam408Teacher)'))
  assert.ok(source.includes('this._exam408Teacher = createExam408TeacherController'))
  assert.ok(source.includes('return this._exam408Teacher'))
})

function loadPage() {
  let page
  let teacherLoads = 0
  const requests = []
  const localRequire = createRequire(path.resolve(__dirname, '../subpackages/exam/result/index.js'))
  const api = {
    get: async url => {
      requests.push(url)
      return {
        accuracy: 0.5, choice_score: 2, total_choice_score: 4,
        correct_count: 1, wrong_count: 1, unanswered_count: 0, duration_sec: 60,
        questions: [{ question_id: 101, status: 'correct' }],
      }
    },
    getErrorMessage: error => error.message,
  }
  vm.runInNewContext(pageSource, {
    Page: definition => { page = definition },
    require: specifier => {
      if (specifier === '../../../utils/api') return api
      if (specifier === '../../../utils/ai-teacher-request') {
        teacherLoads += 1
        throw new Error('AI 服务暂不可用')
      }
      assert.ok(!specifier.includes('../../study/'), 'exam must load without the study package')
      return localRequire(specifier)
    },
    wx: { nextTick: callback => callback(), getWindowInfo: () => ({ statusBarHeight: 20 }) },
    setTimeout,
  })
  page.data = { ...page.data }
  page.setData = patch => Object.assign(page.data, patch)
  return { page, requests, getTeacherLoads: () => teacherLoads }
}

test('cold result page loads the score without loading AI request code', async () => {
  const h = loadPage()
  h.page.onLoad({ attempt_id: '42' })
  await h.page._loadPromise
  assert.deepEqual(h.requests, ['/exams/attempts/42/result'])
  assert.equal(h.page.data.loading, false)
  assert.equal(h.page.data.result.correctCount, 1)
  assert.equal(h.getTeacherLoads(), 0)
})

test('AI module load failure stays in the sheet and action selection uses the current question', async () => {
  const h = loadPage()
  h.page.onLoad({ attempt_id: '42' })
  await h.page._loadPromise
  const result = h.page.data.result
  h.page.select408TeacherAction({ currentTarget: { dataset: { action: 'core_concept' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.getTeacherLoads(), 1)
  assert.equal(h.page.data.teacherLoading, false)
  assert.equal(h.page.data.teacherSheetVisible, true)
  assert.equal(h.page.data.teacherErrorText, 'AI 服务暂不可用')
  assert.equal(h.page.data.result, result)
  assert.equal(Object.keys(h.page._teacherInflight).length, 0)
  h.page.close408Teacher()
  assert.equal(h.page.data.teacherSheetVisible, false)
  assert.equal(h.page.data.result, result)
})

test('teacher opens an action picker before requesting and switches question context safely', async () => {
  const h = loadPage()
  h.page.onLoad({ attempt_id: '42' })
  await h.page._loadPromise
  h.page.open408Teacher()
  assert.equal(h.page.data.teacherSheetVisible, true)
  assert.equal(h.getTeacherLoads(), 0)
  h.page.data.reviewQuestions.push({ questionId: 102, title: '第 2 题' })
  h.page.selectTeacherQuestion({ detail: { value: '1' } })
  assert.equal(h.page._firstQuestionId, 102)
  assert.equal(h.page.data.reviewQuestionIndex, 1)
  assert.equal(h.page.data.teacherResult, null)
  const seen = []
  h.page._exam408Teacher = { run: (action, questionId) => seen.push({ action, questionId }) }
  await h.page.run408Teacher('core_concept')
  h.page.retry408Teacher()
  assert.deepEqual(seen, [{ action: 'core_concept', questionId: 102 }, { action: 'core_concept', questionId: 102 }])
  h.page.data.teacherLoading = true
  h.page.selectTeacherQuestion({ detail: { value: '0' } })
  assert.equal(h.page._firstQuestionId, 102)
})

test('result and accepted wrong-detail share compiled lesson and action templates', t => {
  const { spawnSync } = require('node:child_process')
  const compiler = '/mnt/d/Code/WeixinDev/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'
  if (!fs.existsSync(compiler)) return t.skip('WeChat WXML compiler unavailable')
  const root = path.resolve(__dirname, '..')
  const resultFile = 'subpackages/exam/result/index.wxml'
  const wrongFile = 'subpackages/study/wrong-detail/wrong-detail.wxml'
  const files = [resultFile, wrongFile, 'components/ai-teacher-content/content.wxml', 'components/ai-teacher-content/actions.wxml']
  const compiled = spawnSync(compiler, files, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4e6 })
  assert.equal(compiled.status, 0, compiled.stderr)
  const context = vm.createContext({ window: { __webview_engine_version__: .02 }, console })
  vm.runInContext(compiled.stdout, context)
  const flatten = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(flatten)] : []
  const hasClass = (node, name) => String(node.attr && node.attr.class || '').split(/\s+/).includes(name)
  const teacher = require('../utils/ai-teacher-408')
  for (const file of [resultFile, wrongFile]) {
    const handler = file === resultFile ? 'select408TeacherAction' : 'run408TeacherAction'
    context.fixtureJSON = JSON.stringify({ wq: {}, teacherSheetVisible: true, aiAvailabilityEnabled: true,
      teacherPrimaryActions: teacher.PRIMARY_ACTIONS, teacherMoreActions: teacher.MORE_ACTIONS,
      teacherResult: { title: '管程', summary: '先释放互斥权', sections: [], knowledgePoints: [] } })
    const nodes = flatten(context.$gwx(file)(vm.runInContext('JSON.parse(fixtureJSON)', context)))
    const actions = nodes.filter(node => hasClass(node, 'ai-deep-action'))
    assert.equal(actions.length, 7, file)
    assert.ok(actions.every(node => node.attr.bindtap === handler))
    assert.ok(nodes.some(node => hasClass(node, 'teacher-content')))
    if (file === resultFile) {
      assert.ok(nodes.some(node => node.tag === 'wx-picker'))
      assert.equal(nodes.find(node => hasClass(node, 'page-scroll')).attr.scrollY, true)
    }
  }
})

test('exam uses the accepted confirmation component and hides all review marking', () => {
  const root = path.resolve(__dirname, '..')
  const config = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
  const shared = '/components/submit-confirm/submit-confirm'
  assert.equal(config('subpackages/study/practice/practice.json').usingComponents['submit-confirm'], shared)
  assert.equal(config('subpackages/exam/exam-runner/index.json').usingComponents['submit-confirm'], shared)
  const source = fs.readFileSync(path.join(root, 'subpackages/exam/exam-runner/index.wxml'), 'utf8')
  assert.ok(source.includes('showMarkButton="{{false}}"'))
  assert.ok(!source.includes('bind:togglemark'))
  const { buildExamSubmitEntryPageCapabilities } = require('../subpackages/exam/utils/exam-runner-submit-page-adapter')
  const dialog = buildExamSubmitEntryPageCapabilities({ data: { totalCount: 40, answeredCount: 2, questions: [{ _marked: true }] } }).buildConfirmDialog()
  assert.equal(dialog.layout, 'minimal')
  assert.ok(dialog.message.includes('38'))
  assert.ok(!dialog.message.includes('待检查'))
})

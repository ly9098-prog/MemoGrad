const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { fixture, deferred } = require('./helpers/wrong-detail-ai-recovery-fixture')
const plain = value => JSON.parse(JSON.stringify(value))

if (process.argv[2]) test('compiled AI states retain recovery controls and accurate analysis source hints', () => {
  const vm = require('node:vm')
  const context = vm.createContext({ window: { __webview_engine_version__: 0.02 }, console })
  vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), context)
  const render = context.$gwx('subpackages/study/wrong-detail/wrong-detail.wxml')
  const all = node => [node, ...(node.children || [])
    .flatMap(child => child && typeof child === 'object' ? all(child) : [])]
  const byClass = (tree, cls) => all(tree).filter(node =>
    String((node.attr || {}).class || '').split(/\s+/).includes(cls))
  const base = Object.assign({}, fixture().page.data, {
    loading: false, aiFallback: true, aiCards: null, aiRetryable: true, aiRequested: true,
    aiErrorText: 'AI 服务暂时繁忙，请稍后重试', aiAvailabilityMessage: '服务不可用',
  })
  for (const [enabled, checking, pending, disabled] of [
    [true, false, false, false], [false, false, false, true],
    [false, true, false, false], [false, true, true, true],
  ]) {
    const tree = render({
      ...base, aiAvailabilityEnabled: enabled, aiAvailabilityChecking: checking,
      aiAvailabilityPending: pending,
    })
    assert.equal(byClass(tree, 'ai-review-error').length, 1)
    assert.equal(byClass(tree, 'ai-retry-btn').length, 1)
    assert.equal(Boolean(byClass(tree, 'ai-retry-btn')[0].attr.disabled), disabled)
    assert.equal(byClass(tree, 'ai-availability-note').length, 0)
    assert.equal(byClass(tree, 'ai-loading-state').length, 0)
    assert.equal(all(tree).filter(node => node.tag === 'wx-quiz-runner').length, 1)
    const idle = render({
      ...base, aiFallback: false, aiRequested: false,
      aiAvailabilityEnabled: enabled, aiAvailabilityChecking: checking,
      aiAvailabilityPending: pending,
    })
    if (checking) {
      assert.equal(byClass(idle, 'ai-loading-state').length, 1)
      assert.equal(Boolean(byClass(idle, 'ai-generate-btn')[0].attr.disabled), pending)
    } else {
      assert.equal(Boolean(byClass(idle, 'ai-generate-btn')[0].attr.disabled), pending || !enabled)
    }
  }
  const terminal = render({ ...base, aiRetryable: false })
  assert.equal(byClass(terminal, 'ai-review-error').length, 1)
  assert.equal(byClass(terminal, 'ai-retry-btn').length, 0)
  const aiCards = {
    mistakeDiagnosis: { raw: '错因', text: '错因' },
    knowledgePatch: { raw: '补漏', text: '补漏' },
    reviewTask: { raw: '复练', text: '复练' },
  }
  for (const [cached, questionAnalysis, hint] of [
    [false, false, '内容由 AI 生成，仅供参考'],
    [true, false, '已生成的 AI 分析，仅供参考'],
    [false, true, '当前展示题库解析'],
    [true, true, '当前展示题库解析'],
  ]) {
    const tree = render({ ...base, aiFallback: false, aiCards,
      aiFromCache: cached, aiFromQuestionAnalysis: questionAnalysis })
    assert.equal(byClass(tree, 'ai-hint')[0].children.join(''), hint)
  }
})

test('AI analysis source hint keeps the cached explanation on one line', () => {
  const wxss = fs.readFileSync(path.join(
    __dirname,
    '../subpackages/study/wrong-detail/wrong-detail.wxss'
  ), 'utf8')
  assert.match(wxss, /\.ai-result-tools \.ai-hint\s*\{[^}]*white-space:\s*nowrap;/)
})

function setup() {
  const config = { debug: true }, teacher = {}
  const f = fixture({ config, teacher, exposeDetailHelpers: true })
  f.context.console = {
    error: (...args) => f.calls.push(['error', ...args]),
    warn: (...args) => f.calls.push(['warn', ...args]),
  }
  f.api.getErrorMessage = error => { f.calls.push(['format', error]); return 'formatted' }
  return { ...f, config, teacher }
}

test('CODE invariants retain entity matching, raw-text guard, log order and one live heal hook', () => {
  for (const [rawText, html, nodes, logs, heal] of [
    ['&nbsp;', '', [], 1, true], ['&amp;', '<p/>', [], 2, true],
    ['&#123;', '', ['node'], 2, true], ['&quot;', '', [], 0, false],
    ['', '<p/>', ['node'], 0, false], ['plain', '', [], 0, false],
  ]) {
    const f = setup(), model = { mode: 'CODE', rawText, html, richTextNodes: nodes }
    f.page._enterSafeMode = function () { assert.equal(this, f.page); f.calls.push(['heal']) }
    assert.equal(f.page._checkRenderInvariant(model), undefined)
    assert.equal(f.calls.filter(c => c[0] === 'error').length, logs)
    assert.equal(f.calls.some(c => c[0] === 'heal'), heal)
    if (logs === 2) {
      assert.match(f.calls[0][1], /CODE_HTML_LEAK/)
      assert.match(f.calls[1][1], /CODE_RENDER_VIOLATION/)
      assert.equal(f.calls[2][0], 'heal')
    }
    f.page.data.safeModeActive = true; f.calls.length = 0
    f.page._checkRenderInvariant(model)
    assert.equal(f.calls.some(c => c[0] === 'heal'), false)
  }
  const f = setup()
  f.page._checkRenderInvariant(null)
  assert.deepEqual(f.calls, [])
  assert.throws(() => f.page._checkRenderInvariant({ mode: 'CODE', rawText: 'x' }), { name: 'TypeError' })
})

test('MIXED invariants log empty blocks and per-block leaks without entering safe mode', () => {
  const f = setup()
  f.page._enterSafeMode = () => assert.fail('MIXED must not heal')
  for (const blocks of [undefined, []]) {
    f.page._checkRenderInvariant({ mode: 'MIXED', blocks })
    assert.match(f.calls.at(-1)[1], /MIXED_RENDER_VIOLATION/)
  }
  f.calls.length = 0
  f.page._checkRenderInvariant({ mode: 'MIXED', blocks: [
    { type: 'TEXT', rawText: '&amp;' }, { type: 'CODE', rawText: '&amp;' },
    { type: 'CODE', rawText: '' }, { type: 'CODE', rawText: '&#12;' },
  ] })
  assert.equal(f.calls.length, 2)
  assert.match(f.calls[0][1], /block #1/)
  assert.match(f.calls[1][1], /block #3/)
})

test('trace recording reads live debug flag, guards arrays and retains last twenty references', () => {
  const f = setup(), trace = { id: 'latest' }, previous = Array.from({ length: 22 }, (_, id) => ({ id }))
  f.page.data.renderTraces = previous
  f.page._recordRenderTrace(trace)
  const next = f.page.data.renderTraces
  assert.notEqual(next, previous); assert.equal(previous.length, 22)
  assert.equal(next.length, 20); assert.equal(next[0], previous[3]); assert.equal(next[19], trace)
  f.config.debug = false; f.calls.length = 0
  f.page._recordRenderTrace(trace)
  f.config.debug = true; f.page.data.renderTraces = {}
  f.page._recordRenderTrace(trace)
  f.page._recordRenderTrace(null)
  assert.deepEqual(f.calls, [])
})

test('safe-mode write precedes current question and dynamic renderer lookup, preserving field references', () => {
  const f = setup(), page = f.page, question = { id: 88, retained: 'field' }
  const raw = {
    _optionList: [], _optionKeys: [], _opts: {}, _blankOptionGroups: ['group'],
    _hasBlankOptionGroups: false, _renderModel: { mode: 'CODE' },
    errorTypeLabelText: 'error', subjectLabelText: 'subject',
  }
  const originalSetData = page.setData
  page.setData = function (patch) {
    originalSetData.call(this, patch)
    if (patch.safeModeActive) this.data.wq = question
  }
  f.context.replaceDetailRenderer((wq, safe) => {
    assert.equal(wq, question); assert.equal(safe, true)
    assert.equal(page.data.safeModeActive, true)
    f.calls.push(['render']); return raw
  })
  page._alive = false
  page._enterSafeMode()
  assert.deepEqual(f.calls.map(c => c[0]), ['warn', 'setData', 'render', 'setData', 'warn'])
  assert.equal(page.data.currentQuestion.retained, 'field')
  for (const key of ['_optionList', '_optionKeys', '_opts', '_blankOptionGroups', '_renderModel']) {
    assert.equal(page.data.currentQuestion[key], raw[key])
  }
  assert.equal(page.data.currentQuestion._hasBlankOptionGroups, true)
  assert.equal(page._errorTypeLabelText, 'error')
  assert.equal(page.data.subjectLabelText, 'subject')
  assert.notEqual(page.data.currentQuestion, question)
})

test('safe-mode missing question/model skips projection; renderer errors propagate after activating flag', () => {
  const f = setup(), page = f.page
  page.data.wq = null; page._enterSafeMode()
  assert.deepEqual(f.calls.map(c => c[0]), ['warn', 'setData'])
  page.data.wq = { id: 12 }; f.calls.length = 0
  f.context.replaceDetailRenderer(() => ({}))
  page._enterSafeMode()
  assert.deepEqual(f.calls.map(c => c[0]), ['warn', 'setData'])
  const error = new Error('render')
  f.context.replaceDetailRenderer(() => { throw error })
  assert.throws(() => page._enterSafeMode(), value => value === error)
  assert.equal(page.data.safeModeActive, true)
})

test('teacher action toggling and closing preserve independent busy guards and exact patches', () => {
  const f = setup(), page = f.page
  page.data.teacherLoadingAction = 'busy'
  page.toggleTeacherActions(); assert.deepEqual(f.calls, [])
  page.close408TeacherSheet()
  page.data.teacherLoadingAction = ''
  page.toggleTeacherActions(); page.toggleTeacherActions()
  assert.deepEqual(plain(f.calls), [
    ['setData', { teacherSheetVisible: false }],
    ['setData', { teacherActionsExpanded: true }],
    ['setData', { teacherActionsExpanded: false }],
  ])
})

test('teacher cache keys retain six fields, fallback priority, coercion and falsey behavior', () => {
  const f = setup(), build = f.page._teacherCacheKeyForWrong.bind(f.page)
  assert.equal(build(null, null, null), '0|0|0|0||')
  const item = { id: '12', question_id: '8', questionId: 9, question_version_id: 7, wrong_answer: 'B|C' }
  const diagnosis = { id: '4', question_version_id: 5, questionVersionId: 6 }
  assert.equal(build(item, diagnosis, 'explain'), '12|8|5|4|explain|B|C')
  assert.equal(build({ question_id: 0, questionId: '9', questionVersionId: '6', wrong_answer: 0 },
    { question_version_id: 0, questionVersionId: 'bad' }, 0), '0|9|NaN|0||')
  assert.equal(build({ questionVersionId: 6 }, {}, false), '0|0|6|0||')
})

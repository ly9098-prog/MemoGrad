const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../subpackages/study/practice-result')

if (process.argv[2]) test('native teacher chooser, loading, result and failure retain distinct views', () => {
  const context = vm.createContext({ window: { __webview_engine_version__: 0.02 }, console })
  vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), context)
  const render = context.$gwx('subpackages/study/practice-result/index.wxml')
  const all = node => [node, ...(node.children || []).flatMap(child => child && typeof child === 'object' ? all(child) : [])]
  const base = { ...fixture().page.data, teacherSheetVisible: true,
    teacherResult: { title: '正确项讲解', summary: '依据题设可以判断。', sections: [], knowledgePoints: [] } }
  const classes = tree => all(tree).map(node => (node.attr || {}).class).filter(Boolean).join(' ')
  const chooser = render({ ...base, teacherChoosingAction: true })
  assert.match(classes(chooser), /teacher-action-panel/)
  assert.doesNotMatch(classes(chooser), /teacher-summary-card/)
  const choices = all(chooser).filter(node => (node.attr || {}).bindtap === 'select408TeacherAction')
  assert.equal(choices.length, base.teacherActions.length)
  assert.deepEqual(choices.map(node => node.attr['data-action']), base.teacherActions.map(item => item.action))
  assert.equal(all(chooser).find(node => (node.attr || {}).bindtap === 'cancel408TeacherActions').children.join(''), '返回当前讲解')
  const loading = render({ ...base, teacherResult: null, teacherLoading: true })
  assert.match(classes(loading), /teacher-sheet-loading/)
  assert.doesNotMatch(classes(loading), /teacher-action-panel/)
  const failed = render({ ...base, teacherResult: { ...base.teacherResult, fromFallback: true } })
  assert.doesNotMatch(classes(failed), /teacher-footnote/)
  assert.ok(all(failed).some(node => (node.attr || {}).bindtap === 'retry408Teacher'))
  assert.match(classes(render(base)), /teacher-footnote/)
  const { presentTeacherResult } = require('../subpackages/study/utils/teacher-presentation')
  const variables = render({ ...base, teacherResult: presentTeacherResult({ ...base.teacherResult,
    knowledgePoints: [{ name: 'KMP', relation: 'prerequisite: KMP 使用 next[j] 回退；并查集使用 parent[i]；child = next[j]。' }],
  }) })
  const visibleText = all(variables).flatMap(node => (node.children || []).filter(child => typeof child === 'string')).join(' ')
  assert.ok(visibleText.includes('next[j]'))
  assert.ok(visibleText.includes('parent[i]'))
  assert.ok(visibleText.includes('child = next[j]'))
})

function fixture() {
  let definition
  const calls = []
  const api = {
    get: (...args) => {
      calls.push(['get', ...args])
      return Promise.resolve(args[0] === '/ai/error-analysis/availability'
        ? { status: 'available', enabled: true } : {})
    },
    put: (...args) => { calls.push(['put', ...args]); return Promise.resolve({}) },
    post: (...args) => { calls.push(['post', ...args]); return Promise.resolve({}) },
  }
  const knowledgePracticeSync = {
    record: value => calls.push(['record', value]),
    consumeBaseline: (...args) => calls.push(['consume', ...args]),
  }
  const cache = new Map()
  const context = vm.createContext({
    console, setTimeout, clearTimeout,
    Page: value => { definition = value },
    wx: {
      showToast: value => calls.push(['toast', value]),
      navigateBack: value => calls.push(['back', value]),
      redirectTo: value => calls.push(['redirect', value]),
      reLaunch: value => calls.push(['reLaunch', value]),
    },
    getCurrentPages: () => [{ route: 'pages/home/home' }, { route: 'result' }],
  })
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const requireModule = request => {
      if (request === '../../../utils/api') return api
      if (request === '../../../utils/storage') return { knowledgePracticeSync }
      const resolved = require.resolve(path.resolve(path.dirname(filename), request))
      if (resolved.startsWith(root + path.sep)) return load(resolved)
      return require(resolved)
    }
    const wrapper = vm.runInContext(
      `(function(require,module,exports) {\n${fs.readFileSync(filename, 'utf8')}\n})`, context,
      { filename },
    )
    wrapper(requireModule, module, module.exports)
    return module.exports
  }
  load(path.join(root, 'index.js'))
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    _pageAlive: true, _resultVisible: true, _teacherRequestSeq: 0,
    _diagnosisRefreshSeq: 0, _dashboardLoadId: 1,
    setData(patch) { Object.assign(this.data, patch) },
  })
  const adapter = (name, builder, deps = {}) => load(
    path.join(root, 'utils', `practice-result-${name}-page-adapter.js`)
  )[builder](page, deps)
  return { page, calls, api, adapter, context }
}

test('guest repeat requests a fresh configuration once instead of restoring a draft', () => {
  const { page, calls } = fixture()
  page._guestMode = true
  page.repeatGuestPractice()
  page.repeatGuestPractice()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'redirect')
  const navigation = calls[0][1]
  assert.equal(navigation.url, '/subpackages/study/practice/practice?guest=1&fresh=1')
  navigation.fail()
  assert.equal(page._navigationLocked, false)
  page.repeatGuestPractice()
  assert.equal(calls.length, 2)
})

test('result page memoizes controllers and payload ports per page instance', () => {
  const { page } = fixture()
  const other = fixture().page
  for (const method of ['_batchDiagnosisController', '_trendLoadController',
    '_review408TeacherController', '_backNavigationController',
    '_practicePayloadController', '_practicePayloadPorts']) {
    assert.equal(page[method](), page[method](), method)
    assert.notEqual(page[method](), other[method](), method)
  }
  assert.notEqual(page._practicePageState(), page._practicePageState())
})

test('payload state and cached ports read live page fields and page methods', () => {
  const { page, calls } = fixture()
  const ports = page._practicePayloadPorts()
  const state = page._practicePageState()
  page._launchSubjectId = 7
  assert.equal(ports.getLaunchSubjectId(), 7)
  page._launchSubjectId = 9
  assert.equal(ports.getLaunchSubjectId(), 9)
  page.buildReviewItem = (...args) => args
  assert.equal(ports.buildReviewItem(1, 2, 3, 4).join(','), '1,2,3,4')
  const payload = { marker: true }
  state.setSessionPayload(payload)
  assert.equal(page._sessionPayload, payload)
  state.incrementDiagnosisRefreshSeq()
  assert.equal(page._diagnosisRefreshSeq, 1)
  page._pageAlive = false
  assert.equal(state.isPageAlive(), false)
  ports.recordKnowledgePractice(payload)
  ports.consumeKnowledgeBaseline(9, 10)
  assert.deepEqual(calls, [['record', payload], ['consume', 9, 10]])
})

test('diagnosis adapter uses injected API and live selection and platform ports', async () => {
  const { page, adapter, calls, api, context } = fixture()
  const ports = adapter('diagnosis', 'buildBatchDiagnosisPageCapabilities', { api })
  page.data.batchSelectedMap = { 12: true }
  assert.equal(ports.getBatchSelectedMap(), page.data.batchSelectedMap)
  const payload = { primary_type: 'misread' }
  await ports.putDiagnosis(12, payload)
  assert.deepEqual(calls[0], ['put', '/wrong-questions/12/diagnosis', payload])
  const toast = { title: 'test' }
  context.wx = { showToast: value => calls.push(['new-toast', value]) }
  ports.showToast(toast)
  assert.deepEqual(calls[1], ['new-toast', toast])
})

test('trend controller reaches live page request port and drops late response', async () => {
  const { page } = fixture()
  page.data.trendAvailable = false
  const patches = []
  page.setData = patch => {
    patches.push(patch)
    Object.assign(page.data, patch)
  }
  const controller = page._trendLoadController()
  let resolve
  let request
  page.requestApi = (...args) => {
    request = args
    return new Promise(done => { resolve = done })
  }
  const pending = controller.load(1)
  assert.equal(request[0], '/api/v1/stats/trends')
  assert.equal(request[1].days, 7)
  page._dashboardLoadId = 2
  resolve([{ date: '2026-10-28', accuracy: 80, questions: 5 }])
  await pending
  assert.equal(page.data.trendAvailable, false)
  assert.equal(patches.length, 1, 'stale response must not commit success or final loading state')
  assert.equal(patches[0].trendLoading, true)
})

test('teacher ports preserve request contract, inflight identity and live caches', async () => {
  const { page, adapter, calls, api } = fixture()
  const ports = adapter('teacher', 'buildReview408TeacherPageCapabilities', { api })
  const promise = Promise.resolve('result')
  ports.setInflight('key', promise)
  assert.equal(ports.getInflight('key'), promise)
  ports.deleteInflight('key')
  assert.equal(ports.getInflight('key'), undefined)
  const result = { content: 'analysis' }
  ports.setCacheEntry('key', result)
  assert.equal(ports.getCacheEntry('key'), result)
  page._teacherCache = { key: 'replacement' }
  assert.equal(ports.getCacheEntry('key'), 'replacement')
  assert.equal(ports.nextRequestSequence(), 1)
  assert.equal(ports.getRequestSequence(), 1)
  const payload = { question_id: 4, action: 'core_concept' }
  page.data.reviewDialog = { questionId: 4 }
  await ports.postTeacher(payload)
  const request = calls.find(call => call[0] === 'post')
  assert.equal(calls[0][1], '/ai/error-analysis/availability')
  assert.equal(request[1], '/ai/408-teacher')
  assert.equal(request[2], payload)
  assert.equal(request[3].timeout, 55000)
})

test('shared reader returns from teacher to review and dismisses both states together', async () => {
  const { page, api } = fixture()
  page.data.reviewDialogVisible = true
  page.data.reviewDialog = { questionId: 42, status: 'correct', userAnswer: 'A' }
  let settle
  api.post = () => new Promise(resolve => { settle = resolve })
  const pending = page.run408TeacherFromReview('explain_correct')
  assert.equal(page.data.teacherSheetVisible, true)
  assert.equal(page.data.teacherLoading, true)
  await Promise.resolve()
  await Promise.resolve()
  page.close408Teacher()
  assert.equal(page.data.teacherSheetVisible, false)
  assert.equal(page.data.reviewDialogVisible, true, 'the explicit return action preserves the review')
  page.open408TeacherFromReview()
  assert.equal(page.data.teacherSheetVisible, true, 'the pending request can be revisited')
  page.closeReviewDialog()
  assert.equal(page.data.teacherSheetVisible, false)
  assert.equal(page.data.reviewDialogVisible, false, 'component dismissal must set its show expression false')
  settle({ title: '正确项讲解', summary: '讲解结论', sections: [] })
  await pending
  assert.equal(page.data.teacherSheetVisible, false, 'a late response must not reopen the reader')
  assert.equal(page.data.reviewDialogVisible, false)
})

test('teacher error retries the same action while loading locks the chooser and repeated retries', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 7, status: 'correct', userAnswer: 'A' }
  api.post = async () => { throw new Error('network unavailable') }
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(page.data.teacherAction, 'explain_correct')
  assert.ok(page.data.teacherErrorText)

  let resolve
  const sent = []
  api.post = (_url, payload) => {
    sent.push(payload)
    return new Promise(done => { resolve = done })
  }
  const pending = page.retry408Teacher()
  assert.equal(page.data.teacherLoading, true)
  page.show408TeacherActions()
  page.retry408Teacher()
  await page.run408TeacherFromReview('core_concept')
  assert.equal(page.data.teacherAction, 'explain_correct', 'a second action cannot replace the in-flight retry')
  // Availability is asynchronous; allow the existing request port to dispatch.
  await new Promise(done => setImmediate(done))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].action, 'explain_correct')
  resolve({ action: 'explain_correct', title: '正确选项', sections: [{ heading: '推导', points: ['根据题设可得 A'] }] })
  await pending
  assert.equal(page.data.teacherResult.title, '正确选项')
  const currentResult = page.data.teacherResult
  page.show408TeacherActions()
  assert.equal(page.data.teacherResult, currentResult, 'the chooser preserves the current lesson for cancel')
  assert.equal(page.data.teacherChoosingAction, true)
  assert.equal(page.data.teacherErrorText, '')
  assert.equal(page.data.teacherSheetVisible, true)
  page.cancel408TeacherActions()
  assert.equal(page.data.teacherChoosingAction, false)
  assert.equal(page.data.teacherResult, currentResult)
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(sent.length, 1, 'returning to a successful action retains the existing result cache')
})

test('selecting a lecture style starts a fresh request even when that style was cached', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 42, status: 'correct' }
  let posts = 0, finish
  api.post = async (_url, payload) => {
    posts++
    if (posts === 2) await new Promise(resolve => { finish = resolve })
    return { action: payload.action, sections: [{ heading: '判断依据', points: [`第${posts}次：由题设条件可得正确答案。`] }] }
  }
  await page.run408TeacherFromReview('explain_correct')
  page.show408TeacherActions()
  const pending = page.select408TeacherAction({ currentTarget: { dataset: { action: 'explain_correct' } } })
  assert.equal(page.data.teacherLoading, true)
  assert.equal(page.data.teacherChoosingAction, false)
  assert.equal(page.data.teacherResult, null)
  assert.equal(page.data.teacherSheetVisible, true)
  await new Promise(done => setImmediate(done))
  assert.equal(posts, 2)
  finish()
  await pending
  assert.equal(page.data.teacherLoading, false)
  assert.match(page.data.teacherResult.sections[0].points[0], /第2次/)
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(posts, 2, 'reopening the lesson reuses the newly completed result')
})

test('a failed fresh lecture retries the provider instead of falling back to the old cached success', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 42, status: 'correct' }
  let posts = 0
  api.post = async (_url, payload) => {
    posts++
    return posts === 2 ? { action: payload.action, from_fallback: true } : {
      action: payload.action, sections: [{ heading: '依据', points: ['题设条件满足公式要求，因此该项正确。'] }],
    }
  }
  await page.run408TeacherFromReview('explain_correct')
  page.show408TeacherActions()
  await page.select408TeacherAction({ currentTarget: { dataset: { action: 'explain_correct' } } })
  assert.equal(page.data.teacherResult.fromFallback, true)
  await page.retry408Teacher()
  assert.equal(posts, 3)
  assert.equal(page.data.teacherResult.fromFallback, false)
})

test('practice teacher reuses the wrong-detail knowledge presentation', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 42 }
  api.post = async () => ({ action: 'connect_knowledge', knowledge_points: [{
    name: '中断', relation: 'prerequisite: 指令周期', mastery_hint: 'mastery=0.6;复习响应时机',
  }] })
  await page.run408TeacherFromReview('connect_knowledge')
  const point = page.data.teacherResult.knowledgePoints[0]
  assert.equal(point.relationItems[0].label, '前置知识')
  assert.equal(point.relationItems[0].value, '指令周期')
  assert.match(point.masteryText, /掌握/)
  assert.doesNotMatch([point.relationText, point.masteryText, point.learningHint].join(' '), /prerequisite|mastery=/)
})

test('shared teacher presentation preserves algorithm variables in all teaching text', () => {
  const { presentTeacherResult } = require('../subpackages/study/utils/teacher-presentation')
  const text = 'KMP 使用 next[j] 回退；并查集使用 parent[i] 表示父节点；child = next[j]。'
  const result = presentTeacherResult({ title: 'next 数组', summary: text,
    sections: [{ heading: 'parent[i] 的含义', points: [text] }],
    knowledgePoints: [{ name: 'KMP 的 next 数组', relation: `prerequisite: ${text}`,
      masteryHint: `mastery=0.6;${text}` }],
  })
  assert.equal(result.title, 'next 数组')
  assert.equal(result.summary, text)
  assert.equal(result.sections[0].heading, 'parent[i] 的含义')
  assert.equal(result.sections[0].points[0], text)
  assert.equal(result.knowledgePoints[0].name, 'KMP 的 next 数组')
  assert.equal(result.knowledgePoints[0].relationItems[0].label, '前置知识')
  const relationText = [result.knowledgePoints[0].relationItems[0].value,
    result.knowledgePoints[0].relationText].join(' ')
  assert.ok(relationText.includes('next[j]'))
  assert.ok(relationText.includes('parent[i]'))
  assert.ok(relationText.includes('child = next[j]'))
  assert.equal(result.knowledgePoints[0].learningHint, text)
})

test('teacher cannot generate after changing the reviewed question during the health query', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 42 }
  let finishStatus, posts = 0
  api.get = () => new Promise(resolve => { finishStatus = resolve })
  api.post = async () => { posts++; return {} }
  const pending = page.run408TeacherFromReview('explain_correct')
  assert.equal(page.data.teacherLoading, true)
  page.data.reviewDialog = { questionId: 43 }
  finishStatus({ status: 'available', enabled: true })
  await pending
  assert.equal(posts, 0)
  assert.equal(page.data.teacherResult, null)
})

test('review teacher retries after fallback and retains successful result caching', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 42, status: 'correct' }
  let posts = 0
  api.post = async () => ({ action: 'explain_correct', summary: 'lesson',
    sections: [{ heading: '依据', points: ['满足题干条件。'] }], from_fallback: ++posts === 1 })
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(page.data.teacherResult.fromFallback, true)
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(posts, 2)
  assert.equal(page.data.teacherResult.fromFallback, false)
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(posts, 2)
})

test('a fragment result offers a direct same-action retry and is never cached', async () => {
  const { page, api } = fixture()
  page.data.reviewDialog = { questionId: 42, status: 'correct' }
  const actions = []
  api.post = async (_url, payload) => {
    actions.push(payload.action)
    return { action: payload.action, summary: '正确选项为 C，下面给出完整推理链。',
      sections: [{ heading: '第一步', points: [actions.length === 1 ? '题干明确' : '无噪声信道使用 R=2Wlog₂V，代入可得48kb/s。'] }] }
  }
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(page.data.teacherResult.fromFallback, true)
  assert.equal(page.data.teacherErrorText, '')
  await page.retry408Teacher()
  assert.deepEqual(actions, ['explain_correct', 'explain_correct'])
  assert.equal(page.data.teacherResult.fromFallback, false)
  await page.run408TeacherFromReview('explain_correct')
  assert.equal(actions.length, 2, 'only the complete result may be reused')
})

test('back navigation preserves page lock and invokes runtime platform callbacks', () => {
  const { page, calls, context } = fixture()
  page._returnTo = '/pages/home/home'
  page.handleBack()
  assert.equal(page._navigationLocked, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'back')
  assert.equal(calls[0][1].delta, 1)
  page.handleBack()
  assert.equal(calls.length, 1)
  page._navigationLocked = false
  context.wx.navigateBack = value => calls.push(['replacement', value])
  page.handleBack()
  assert.equal(calls[1][0], 'replacement')
})

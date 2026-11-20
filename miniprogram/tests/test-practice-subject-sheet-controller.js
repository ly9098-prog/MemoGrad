const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createSubjectSheetController,
  SUBJECT_DOUBLE_TAP_INTERVAL,
} = require('../subpackages/study/practice/utils/subject-sheet-controller')

function createHarness(overrides = {}) {
  const state = {
    alive: true,
    visible: false,
    closing: false,
    closeTimer: null,
    lastTap: null,
    patches: [],
    callbacks: [],
    timers: [],
    closed: 0,
    cleared: [],
  }
  const controller = createSubjectSheetController({
    getCloseTimer: () => state.closeTimer,
    setCloseTimer: timer => { state.closeTimer = timer },
    clearTimeout: timer => state.cleared.push(timer),
    setData: (patch, callback) => {
      state.patches.push(patch)
      if (callback) state.callbacks.push(callback)
    },
    isVisible: () => state.visible,
    isClosing: () => state.closing,
    isPageAlive: () => state.alive,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay }
      state.timers.push(timer)
      return timer
    },
    getLastTap: () => state.lastTap,
    setLastTap: value => { state.lastTap = value },
    now: () => 1000,
    closeSheet: () => { state.closed += 1 },
    ...overrides,
  })
  return { controller, state }
}

test('open clears a pending close timer and resets view flags', () => {
  const { controller, state } = createHarness()
  const timer = { id: 1 }
  state.closeTimer = timer

  controller.open()

  assert.deepEqual(state.cleared, [timer])
  assert.equal(state.closeTimer, null)
  assert.deepEqual(state.patches, [{ subjectSheetVisible: true, subjectSheetClosing: false }])
})

test('hide invokes callback immediately when already hidden', () => {
  const { controller, state } = createHarness()
  let called = false

  controller.hide(() => { called = true })

  assert.equal(called, true)
  assert.deepEqual(state.patches, [])
})

test('hide schedules one 180ms close and invokes callback after commit', () => {
  const { controller, state } = createHarness()
  state.visible = true
  let called = false

  controller.hide(() => { called = true })

  assert.deepEqual(state.patches, [{ subjectSheetClosing: true }])
  state.callbacks[0]()
  assert.equal(state.timers.length, 1)
  assert.equal(state.timers[0].delay, 180)
  state.timers[0].callback()
  assert.deepEqual(state.patches[1], {
    subjectSheetVisible: false,
    subjectSheetClosing: false,
  })
  state.callbacks[1]()
  assert.equal(called, true)
})

test('hide is idempotent while closing and ignores page death', () => {
  const { controller, state } = createHarness()
  state.visible = true
  state.closing = true
  controller.hide()
  assert.equal(state.patches.length, 0)
  state.closing = false
  controller.hide()
  state.callbacks[0]()
  const patchCount = state.patches.length
  state.closing = true

  controller.hide()
  assert.equal(state.patches.length, patchCount)

  state.timers[0].callback()
  assert.equal(state.closeTimer, null)
  assert.equal(state.patches.length, patchCount + 1)
})

test('option tap tracks source and closes on same-key double tap', () => {
  const { controller, state } = createHarness()
  state.visible = true

  controller.handleOptionTap(408, 'parent')
  assert.deepEqual(state.lastTap, { key: 'parent:408', time: 1000 })
  assert.equal(state.closed, 0)

  controller.handleOptionTap(408, 'parent')
  assert.equal(state.lastTap, null)
  assert.equal(state.closed, 1)
  assert.equal(SUBJECT_DOUBLE_TAP_INTERVAL, 320)
})

test('option tap ignores hidden, closing and invalid targets', () => {
  const { controller, state } = createHarness()
  controller.handleOptionTap(408, 'parent')
  assert.equal(state.lastTap, null)

  state.visible = true
  state.closing = true
  controller.handleOptionTap(408, 'parent')
  assert.equal(state.lastTap, null)

  state.closing = false
  controller.handleOptionTap(0, 'parent')
  assert.equal(state.lastTap, null)
})

function sheetHarness() {
  const tree = require('../subpackages/study/practice/utils/subject-tree')
  const state = {
    subjectTree: tree.normalizeSubjectTree([
      { subject_id: 10, subject_code: 'math', display_name: '数学', children: [
        { subject_id: 11, display_name: '高等数学' },
      ] },
      { subject_id: 70, subject_code: 'exam408', display_name: '计算机综合', children: [
        { subject_id: 71, display_name: '数据结构', children: [{ subject_id: 72, display_name: '线性表' }] },
        { subject_id: 73, display_name: '操作系统' },
      ] },
    ]),
    data: {}, writes: [], selections: [], timers: [],
  }
  let controller
  controller = createSubjectSheetController({
    getSubjectTree: () => state.subjectTree,
    getSelectedSubjectId: () => 72,
    getSheetPages: () => state.data.subjectSheetPages,
    getCurrentIndex: () => state.data.subjectSheetCurrent,
    getDraft: () => state.data.subjectSheetDraft,
    getCloseTimer: () => null, setCloseTimer() {}, clearTimeout() {},
    setData(patch, callback) { state.writes.push(patch); Object.assign(state.data, patch); if (callback) callback() },
    isVisible: () => state.data.subjectSheetVisible,
    isClosing: () => state.data.subjectSheetClosing,
    isPageAlive: () => true,
    setTimeout(callback, delay) { state.timers.push({ callback, delay }); return 1 },
    selectSubject: (...args) => state.selections.push(args),
  })
  controller.open()
  return { state, controller }
}

test('native swipe clears only the draft; programmatic, repeated and invalid change events preserve it', () => {
  const { state, controller } = sheetHarness()
  assert.equal(state.data.subjectSheetPages[1].node_id, 71, 'opening restores the selected descendant path')
  controller.stage(71)
  const draft = state.data.subjectSheetDraft
  const before = state.writes.length
  for (const detail of [
    { current: 0, source: '' }, { current: 0, source: 'autoplay' },
    { current: 1, source: 'touch' }, { current: -1, source: 'touch' },
    { current: 9, source: 'touch' }, { current: 0.5, source: 'touch' },
    { current: '0', source: 'touch' }, {},
  ]) controller.change({ detail })
  assert.equal(state.writes.length, before)
  assert.equal(state.data.subjectSheetDraft, draft)
  controller.change({ detail: { current: 0, source: 'touch' } })
  assert.equal(state.data.subjectSheetCurrent, 0)
  assert.equal(state.data.subjectSheetDraft, null)
  controller.stage(11)
  const mathDraft = state.data.subjectSheetDraft
  const after = state.writes.length
  controller.change({ detail: { current: 0, source: 'touch' } })
  controller.change({ detail: { current: 9, source: 'touch' } })
  assert.equal(state.writes.length, after)
  assert.equal(state.data.subjectSheetDraft, mathDraft)
  assert.deepEqual(state.selections, [])
  controller.change({ detail: { current: 1, source: 'touch' } })
  assert.equal(state.data.subjectSheetCurrent, 1, 'native circular wrap can report either valid edge index')
  assert.equal(state.data.subjectSheetDraft, null)
})

test('cross-discipline swipe prevents confirmation until a subject on the current page is staged', () => {
  const { state, controller } = sheetHarness()
  controller.stage(71)
  controller.change({ detail: { current: 0, source: 'touch' } })
  controller.confirm()
  assert.deepEqual(state.selections, [], 'the offscreen subject cannot be committed')
  assert.equal(state.data.subjectSheetClosing, false)
  controller.stage(10)
  controller.confirm()
  assert.deepEqual(state.selections, [[10, '数学（全部）', 10, true]])
  assert.equal(state.data.subjectSheetClosing, true)
})

test('browsing a subject never selects all; only explicit scope staging plus confirmation commits', () => {
  const { state, controller } = sheetHarness()
  controller.browse(70)
  controller.chooseCard(71)
  assert.equal(state.data.subjectSheetPages[1].node_id, 71)
  assert.equal(state.data.subjectSheetDraft.subject_id, 72)
  assert.deepEqual(state.selections, [])
  controller.browse(state.data.subjectSheetPages[1].back_id)
  assert.equal(state.data.subjectSheetPages[1].node_id, 70)
  assert.equal(state.data.subjectSheetDraft.subject_id, 72, 'returning preserves the draft')
  controller.chooseCard(71)
  controller.stage(71)
  assert.equal(state.data.subjectSheetDraft.display_name, '数据结构（全部）')
  assert.deepEqual(state.selections, [])
  controller.confirm()
  assert.deepEqual(state.selections, [[71, '数据结构（全部）', 70, true]])
  assert.equal(state.data.subjectSheetClosing, true)
  controller.confirm()
  assert.equal(state.selections.length, 1)
})

test('cancel discards a draft; foreign or disabled subjects cannot be confirmed', () => {
  const { state, controller } = sheetHarness()
  controller.browse(70)
  controller.chooseCard(73)
  assert.equal(state.data.subjectSheetDraft.subject_id, 73)
  controller.hide()
  state.timers.at(-1).callback()
  controller.open()
  assert.equal(state.data.subjectSheetDraft.subject_id, 72)
  controller.chooseCard(11)
  assert.equal(state.data.subjectSheetDraft.subject_id, 72)
  state.subjectTree = []
  controller.confirm()
  assert.deepEqual(state.selections, [])
})

function practicePageHarness(guestMode) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
  const { subjectCatalogFixture } = require('./helpers/practice-page-fixture')
  const filename = path.resolve(__dirname, '../subpackages/study/practice/practice.js')
  const requests = [], timers = []
  let definition
  const catalog = subjectCatalogFixture()
  const platform = { getStorageSync: () => [], setStorageSync() {}, showToast() {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value }, wx: platform, console,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length },
    clearTimeout() {},
    require(name) {
      if (name === '../../../utils/api') return {
        createTraceId: () => 'subject-sheet-test',
        get: async (...args) => { requests.push(args); return guestMode ? { items: catalog } : catalog },
      }
      return require(path.resolve(path.dirname(filename), name))
    },
  }, { filename })
  const page = { ...definition, _pageAlive: true, _subjectsRequestSeq: 0,
    data: { ...JSON.parse(JSON.stringify(definition.data)), guestMode, count: 20, selectedMode: 'random' },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  }
  return { page, requests, timers }
}

for (const guestMode of [false, true]) {
  test(`${guestMode ? 'guest' : 'signed-in'}: real page confirms IDs and scope, retains count/mode, and loads only on start`, async () => {
    const { page, requests, timers } = practicePageHarness(guestMode)
    await page.loadPracticeSubjects({ skipAutostart: true })
    assert.equal(requests[0][0], guestMode ? '/guest/practice/subjects' : '/practice/subjects')
    if (guestMode) assert.equal(requests[0][2].auth, 'none')
    assert.equal(page.data.selectedSubjectId, 70)
    page._launchKnowledgePointId = 999
    page.openSubjectSheet()
    page.toggleParentExpansion({ detail: { current: 1, source: '' } })
    assert.equal(page.data.subjectSheetCurrent, 0, 'programmatic events cannot undo the 408 default')
    assert.equal(page.data.subjectSheetDraft.subject_id, 70)
    page.toggleParentExpansion({ detail: { current: 1, source: 'touch' } })
    assert.equal(page.data.subjectSheetDraft, null)
    page.chooseChildSubject({ currentTarget: { dataset: { action: 'confirm' } } })
    assert.equal(page.data.selectedSubjectId, 70, 'swiping cannot change the committed practice subject')
    assert.equal(page._launchKnowledgePointId, 999)
    page.closeSubjectSheet()
    timers.at(-1).callback()
    page.openSubjectSheet()
    assert.equal(page.data.subjectSheetCurrent, 0, 'cancel and reopen restore the committed discipline')
    assert.equal(page.data.subjectSheetDraft.subject_id, 70)
    page.chooseChildSubject({ currentTarget: { dataset: { subjectId: 71 } } })
    assert.equal(page.data.selectedSubjectId, 70, 'a card tap only previews')
    assert.equal(page._launchKnowledgePointId, 999)
    page.chooseChildSubject({ currentTarget: { dataset: { action: 'confirm' } } })
    assert.equal(page.data.selectedSubjectId, 71)
    assert.equal(page.data.selectedSubjectHasChildren, false)
    assert.equal(page._launchKnowledgePointId, null, 'changing the confirmed scope clears old launch constraints')
    assert.equal(page.data.count, 20)
    assert.equal(page.data.selectedMode, 'random')
    assert.equal(requests.length, 1, 'confirmation never prematurely loads a question batch')
    const params = page._buildQuestionRequestParams()
    assert.equal(params.subject_id, 71)
    assert.equal(params.include_children, false)
    assert.equal(params.count, 20)
    assert.deepEqual(Array.from(page._getPracticeSubjectScopeIds(71, false)), [71])
    timers.at(-1).callback()
    page.openSubjectSheet()
    assert.equal(page.data.subjectSheetDraft.subject_id, 71)
    page.chooseParentSubject({ currentTarget: { dataset: { subjectId: 70 } } })
    page.chooseChildSubject({ currentTarget: { dataset: { action: 'confirm' } } })
    assert.equal(page._buildQuestionRequestParams().include_children, true)
    assert.deepEqual(Array.from(page._getPracticeSubjectScopeIds(70, true)).sort(), [70, 71, 72, 73, 74])
    page._readPendingSubmission = () => null
    page._setPracticeUnloadGuard = () => {}
    let loads = 0
    page._loadQuestions = async () => { loads += 1 }
    const controller = page._startPracticeController()
    await controller.start()
    assert.equal(loads, 1)
  })
}

test('sheet keeps native swiping, a compact title action and square text options without repeated copy', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.resolve(__dirname, '../subpackages/study/practice')
  const wxml = fs.readFileSync(path.join(root, 'practice.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'practice.wxss'), 'utf8')
  assert.match(wxml, /<swiper[^>]*circular="\{\{subjectSheetPages\.length > 1\}\}"[^>]*autoplay="\{\{false\}\}"[^>]*display-multiple-items="1"/)
  assert.match(wxml, /bindchange="toggleParentExpansion"/)
  assert.match(wxml, /data-action="confirm">确定选择/)
  const gridMarkup = wxml.slice(wxml.indexOf('<view class="subject-options-grid"'), wxml.indexOf('</swiper>'))
  assert.ok(!/subject-option-action|subject-option-icon|>选择科目<\/text>|>已预选<\/text>/.test(gridMarkup),
    'subject cards have no repeated icons or action captions')
  const sheetMarkup = wxml.slice(wxml.indexOf('<view class="subject-sheet-layer'), wxml.indexOf('<view class="practice route-enter-task'))
  assert.ok(!/subject-discipline-hint|subject-sheet-selection|左右滑动切换学科/.test(sheetMarkup))
  assert.match(sheetMarkup, /class="subject-discipline-dots" wx:if="\{\{subjectSheetPages.length > 1\}\}"/)
  assert.match(sheetMarkup, /subject-sheet-rows-\{\{subjectSheetPages\[subjectSheetCurrent\].grid_rows/)
  assert.match(css, /\.subject-options-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /\.subject-option\{[^}]*min-height:288rpx/)
  assert.match(css, /\.subject-sheet-layer \.subject-sheet\{[^}]*width:100%;height:calc\([^}]*max-height:82vh/)
  assert.match(css, /\.subject-sheet \.subject-discipline-scroll\{[^}]*height:100%;width:100%/)
  assert.match(css, /\.subject-sheet \.sheet-close\{[^}]*width:44px;height:44px/)
  assert.match(css, /\.subject-scope-option\{[^}]*display:inline-flex[^}]*min-width:44px;min-height:44px[^}]*background:transparent/)
  assert.match(css, /\.subject-empty-hint\{[^}]*font-size:max\(24rpx,12px\)/)
  for (const selector of ['subject-option-name', 'subject-sheet-confirm']) {
    assert.ok(new RegExp(`\\.${selector}\\{[^}]*font-size:max\\(28rpx,14px\\)`).test(css),
      `${selector} remains at least 14px on narrow devices`)
  }
})

test('compiled sheet retains circular/one-page behavior, enabled grids, draft confirmation and empty states', {
  skip: !process.env.PRACTICE_SUBJECT_WXML && 'set PRACTICE_SUBJECT_WXML to the native WXML compiler output',
}, () => {
  const fs = require('node:fs'), vm = require('node:vm')
  const { subjectCatalogFixture } = require('./helpers/practice-page-fixture')
  const tree = require('../subpackages/study/practice/utils/subject-tree')
  const { buildSubjectSheetView } = require('../subpackages/study/practice/utils/subject-sheet-view')
  const context = vm.createContext({ window: { __webview_engine_version__: 0.02 }, console })
  vm.runInContext(fs.readFileSync(process.env.PRACTICE_SUBJECT_WXML, 'utf8'), context)
  const render = context.$gwx('subpackages/study/practice/practice.wxml')
  assert.equal(typeof render, 'function')
  const all = node => [node, ...(node.children || []).flatMap(child => child && typeof child === 'object' ? all(child) : [])]
  const byClass = (node, name) => all(node).filter(item => String((item.attr || {}).class || '').split(/\s+/).includes(name))
  const text = node => node == null ? '' : typeof node === 'object' ? (node.children || []).map(text).join('') : String(node)
  const base = { entryResolved: true, started: false, subjectSheetVisible: true }
  const catalog = tree.normalizeSubjectTree(subjectCatalogFixture())
  const many = render({ ...base, ...buildSubjectSheetView(catalog, 71) })
  const swiper = byClass(many, 'subject-discipline-swiper')[0]
  assert.equal(swiper.attr.circular, true)
  assert.equal(swiper.attr.autoplay, false)
  assert.equal(Number(swiper.attr.displayMultipleItems), 1)
  assert.equal(byClass(many, 'subject-discipline-item').length, 4)
  const computer = byClass(many, 'subject-discipline-item')[0]
  assert.equal(byClass(computer, 'subject-option').length, 4)
  assert.equal(byClass(computer, 'subject-option-icon').length, 0)
  assert.equal(byClass(byClass(computer, 'subject-discipline-heading')[0], 'subject-scope-option').length, 1)
  assert.equal(text(byClass(computer, 'subject-scope-option')[0]), '选整科')
  assert.equal(byClass(many, 'subject-discipline-dot').length, 4)
  assert.equal(byClass(many, 'subject-discipline-dot').filter(dot => dot.attr.class.includes('active')).length, 1)
  assert.equal(text(byClass(many, 'subject-sheet-footer')[0]), '确定选择')
  assert.equal(byClass(many, 'subject-sheet-confirm')[0].attr.ariaLabel, '确认选择数据结构')
  assert.equal(byClass(many, 'subject-option-check').length, 1)
  assert.equal(byClass(many, 'subject-sheet-confirm')[0].attr.disabled, false)
  const swiped = render({ ...base, ...buildSubjectSheetView(catalog, 71), subjectSheetCurrent: 1, subjectSheetDraft: null })
  assert.equal(byClass(swiped, 'subject-sheet-confirm')[0].attr.disabled, true,
    'swiping to another available discipline disables confirmation until explicit staging')
  const single = render({ ...base, ...buildSubjectSheetView(catalog.slice(0, 1), 70) })
  assert.equal(byClass(single, 'subject-discipline-swiper')[0].attr.circular, false)
  assert.equal(byClass(single, 'subject-discipline-dots').length, 0)
  const rawBranch = subjectCatalogFixture()
  rawBranch[1].children[0].children = [{ subject_id: 83, display_name: '微积分', children: [] }]
  const branchView = buildSubjectSheetView(tree.normalizeSubjectTree(rawBranch), 83)
  const branch = render({ ...base, ...branchView })
  const math = byClass(branch, 'subject-discipline-item')[branchView.subjectSheetCurrent]
  assert.equal(text(byClass(math, 'subject-discipline-title')[0]), '高等数学')
  assert.equal(byClass(math, 'subject-branch-back')[0].attr['data-subject-id'], 80)
  assert.equal(text(byClass(math, 'subject-scope-option')[0]), '选全部')
  assert.equal(text(byClass(math, 'subject-option-name')[0]), '微积分')
  const leaf = render({ ...base, ...buildSubjectSheetView(catalog.slice(2, 3), 90) })
  assert.equal(text(byClass(leaf, 'subject-scope-option')[0]), '选择')
  assert.equal(byClass(leaf, 'subject-options-grid').length, 0)
  const empty = render({ ...base, ...buildSubjectSheetView([]) })
  assert.equal(byClass(empty, 'subject-discipline-swiper').length, 0)
  assert.equal(byClass(empty, 'subject-empty').length, 1)
  assert.equal(byClass(empty, 'subject-sheet-confirm')[0].attr.disabled, true)
})

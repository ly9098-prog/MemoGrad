/* Formula reading regressions; Node only, no credentials or network. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const content = require('../subpackages/formulas/utils/formula-content')
const katex = require('../subpackages/formulas/utils/katex/katex.min')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const prepare = latex => content.prepareFormulaBlocks({ formula_blocks: [{ label: '根式积分', latex }] })[0]
const longIntegral = String.raw`\int \sqrt{a^2-x^2}\,dx=\frac{a^2}{2}\arcsin\frac{x}{a}+\frac{x}{2}\sqrt{a^2-x^2}+C`
const fixture = prepare(longIntegral)
assert.equal(fixture.readingRows.length, 1)
assert.equal(fixture.readingRows[0].lines.length, 2, 'long equality breaks at its equals sign')
assert.equal(fixture.readingRows[0].lines.join('').replace(/\s/g, ''), fixture.latex.replace(/\s/g, ''),
  'layout must not drop operands, constants or conditions')
const longCjkText = prepare(String.raw`\text{${'长'.repeat(30)}}`)
const longLatinText = prepare('x'.repeat(80))
assert.equal(longCjkText.readingRows[0].isScrollable, false,
  'complexity remains a hint, not proof that long CJK text fits the viewport')
assert.equal(longLatinText.readingRows[0].isScrollable, false,
  'complexity remains a hint, not proof that long Latin text fits the viewport')
const grouped = prepare(String.raw`\int x\,dx=\frac{x^2}{2}+C\\\int x^2\,dx=\frac{x^3}{3}+C\\\int x^3\,dx=\frac{x^4}{4}+C`)
assert.equal(grouped.readingRows.length, 3, 'independent identities become separate rows')
assert.equal(prepare(String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`).readingRows.length, 2)
const preserved = [
  String.raw`\begin{aligned}a&=b\\&=c\end{aligned}`,
  String.raw`\begin{cases}x&x>0\\0&x\le0\end{cases}`,
  String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,
  String.raw`\begin{aligned}x&=\begin{cases}1&t>0\\0&t\le0\end{cases}\\y&=0\end{aligned}`,
  String.raw`\begin{gathered}\text{a=b\\c=d}\end{gathered}`,
]
for (const latex of preserved) {
  const block = prepare(latex)
  assert.equal(block.readingRows.length, 1, 'structured expression stays atomic: ' + latex)
  assert.deepEqual(block.readingRows[0].lines, [block.latex])
}
for (const latex of [longIntegral + '=z', longIntegral.replace('=', '<='), longIntegral.replace('=', '< ='),
  longIntegral.replace('=', ':='),
  String.raw`\left|` + longIntegral + String.raw`\right|`,
  String.raw`\left\{` + longIntegral + String.raw`\right\}`, longIntegral + '{']) {
  assert.deepEqual(content.formulaReadingLines(latex), [latex], 'ambiguous splitting fails closed')
}
assert.deepEqual(content.formulaReadingLines('x=y'), ['x=y'])
const absoluteIntegral = longIntegral.replace('=\\frac', '=\\left|\\frac') + String.raw`\right|`
assert.equal(content.formulaReadingLines(absoluteIntegral).length, 2,
  'absolute values on the right must not block a safe equality split')
for (const block of [fixture, grouped, ...preserved.slice(0, 4).map(prepare)]) {
  for (const row of block.readingRows) for (const latex of row.lines) {
    assert.doesNotMatch(katex.renderToString(latex, { throwOnError: true }), /katex-error/)
  }
}
// Exercise component methods and observer invalidation without a WeChat runtime.
let definition
const previousWx = global.wx
global.wx = { getWindowInfo: () => ({ windowWidth: 375 }), getDeviceInfo: () => ({ system: 'Node test' }) }
const previous = global.Component
global.Component = value => { definition = value }
try { require('../subpackages/formulas/components/formula-card/index') } finally {
  if (previous === undefined) delete global.Component
  else global.Component = previous
  if (previousWx === undefined) delete global.wx
  else global.wx = previousWx
}
const runtimeFixture = Object.assign({}, fixture, {
  readingRows: fixture.readingRows.map(row => Object.assign({}, row, {
    canScrollX: true,
    lineItems: row.lines.map((line, index) => ({ _key: String(index), mathNodes: [] })),
    fullLineItem: { _key: row._key + '-full', mathNodes: [] },
  })),
})
const target = Object.assign({
  data: { ...definition.data, formulaBlocks: [runtimeFixture], card: {} },
  events: [], writes: [],
  createSelectorQuery: () => queryFixture([[{ width: 100, height: 40 }, { width: 100, height: 40 }], { height: 18 }, null]),
  setData(patch, callback) { this.writes.push(patch); Object.assign(this.data, patch); if (callback) callback() },
  triggerEvent(name) { this.events.push(name) },
}, definition.methods)
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
assert.equal(target.data.expandedBlock.latex, fixture.latex)
assert.equal(target.data.expandedBlock.readingRows[0].lineItems.length, 1, 'panel starts with complete equations')
assert.equal(runtimeFixture.readingRows[0].lineItems.length, 2, 'panel never mutates the reader source')
assert.deepEqual(target.events, ['formulastart', 'readingchange'])
assert.equal(target.data.expandedVisible, true)
const retainedBlock = target.data.expandedBlock
target.closeFormulaReading()
target.closeFormulaReading()
assert.equal(target.data.expandedVisible, false)
assert.equal(target.data.expandedBlock, retainedBlock, 'native Back shell and math survive the sheet exit')
assert.deepEqual(target.events, ['formulastart', 'readingchange'], 'reader stays locked until physical exit completes')
target.onReadingClosed()
assert.equal(target.data.expandedBlock, null)
assert.deepEqual(target.events, ['formulastart', 'readingchange', 'readingchange', 'formulaend'])
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
assert.equal(target.data.expandedBlock, null, 'reopening waits for native Back shell removal')
target.onReadingAfterLeave()
target.onReadingClosed()
target.onReadingAfterLeave()
assert.equal(target.events.length, 4, 'closed and native afterleave are idempotent')
target.openFormulaReading({ currentTarget: { dataset: { index: 99 } } })
assert.equal(target.data.expandedBlock, null)
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
definition.properties.card.observer.call(target, { id: 2, formula_blocks: [{ latex: 'x=y' }] }, { id: 1 })
assert.equal(target.data.expandedBlock, null, 'switching card dismisses stale expanded content')
assert.equal(target.events.at(-1), 'formulaend')
assert.equal(target.data.formulaBlocks[0].readingRows[0].lineItems.length, 1)
target.onReadingAfterLeave()
// Physical exits must release native Back ownership exactly once, regardless
// of whether the exit originated in business logic, the grip, or system Back.
function readingCard() {
  return Object.assign({
    data: { ...definition.data, formulaBlocks: [runtimeFixture], card: {} },
    events: [],
    createSelectorQuery: () => queryFixture([[{ width: 200, height: 900 }, { width: 500, height: 900 }], { height: 18 }, null]),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }, definition.methods)
}
for (const reason of ['business', 'gesture', 'back', 'hide']) {
  const card = readingCard()
  card.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
  const math = card.data.expandedBlock
  assert.equal(card.data.expandedHeight + 28, Math.floor(667 * 0.8), 'grip fits inside the original 80% viewport cap')
  assert.equal(card.data.expandedScrollHeight + card.data.expandedHeaderHeight, card.data.expandedHeight)
  if (reason === 'business') {
    card.closeFormulaReading()
    card.toggleCardFlip()
    assert.equal(card.data.expandedBlock, math, 'closing retains the same prepared math nodes')
    assert.equal(card.events.length, 2, 'scroll/navigation lock remains until closed')
    card.onReadingClosed()
  } else if (reason === 'gesture') {
    card.closeFormulaReading({ detail: { completed: true } })
  } else if (reason === 'back') {
    card.onReadingAfterLeave()
  } else {
    definition.pageLifetimes.hide.call(card)
    definition.pageLifetimes.show.call(card)
  }
  assert.equal(card.data.expandedVisible, false, reason)
  assert.equal(card.data.expandedBlock, null, reason)
  card.onReadingClosed()
  card.onReadingAfterLeave()
  assert.deepEqual(card.events.map(event => event.name), ['formulastart', 'readingchange', 'readingchange', 'formulaend'])
  assert.deepEqual(card.events.filter(event => event.name === 'readingchange').map(event => event.detail.expanded), [true, false])
  card.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(card.data.expandedVisible, true, 'reading can reopen after ' + reason)
  card.onReadingClosed()
  assert.ok(card.data.expandedBlock, 'late closed from the previous exit cannot dismiss a reopened sheet')
  definition.lifetimes.detached.call(card)
  const eventCount = card.events.length
  card.onReadingClosed()
  card.onReadingAfterLeave()
  assert.equal(card.events.length, eventCount, 'late native/sheet completions cannot write after detach')
}
// Reader must not interpret horizontal formula scrolling as card navigation.
let readerDefinition
require('node:vm').runInNewContext(read('subpackages/formulas/reader/index.js'), {
  require: () => ({}), Page: value => { readerDefinition = value }, console,
  clearTimeout: () => {}, setTimeout: callback => { callback(); return 1 },
})
const reader = Object.assign({}, readerDefinition, {
  data: { ...readerDefinition.data, readerScrollTop: 1750 },
  nextCount: 0,
  setData(patch) { Object.assign(this.data, patch) },
  goNext() { this.nextCount++ },
})
function swipeLeft() {
  reader.onReaderTouchStart({ touches: [{ clientX: 200, clientY: 100 }] })
  reader.onReaderTouchMove({ touches: [{ clientX: 80, clientY: 100 }] })
  reader.onReaderTouchEnd({ changedTouches: [{ clientX: 80, clientY: 100 }] })
}
reader.onFormulaReadingChange({ detail: { expanded: true } })
reader.onFormulaGestureStart()
swipeLeft()
assert.equal(reader.nextCount, 0, 'expanded/formula gesture cannot change the card')
reader.onFormulaReadingChange({ detail: { expanded: false } })
reader.onFormulaGestureEnd()
assert.equal(reader.data.readerScrollTop, 1750, 'closing must not reset scroll position')
swipeLeft()
assert.equal(reader.nextCount, 1, 'normal page swipe still changes the card')
const template = read('subpackages/formulas/components/formula-card/index.wxml')
assert.match(template, /fc-flip-stage/)
assert.match(fs.readFileSync(path.join(root, 'subpackages/formulas/components/formula-card/index.wxss'), 'utf8'), /\.fc-flip-shell\.is-recite\s*\{[^}]*perspective:\s*500px;[^}]*\}/)
assert.match(fs.readFileSync(path.join(root, 'subpackages/formulas/components/formula-card/index.wxss'), 'utf8'), /\.fc-flip-stage\.is-recite\s*\{[^}]*transform-style:\s*preserve-3d;[^}]*transition:\s*transform\s*520ms/)
assert.match(template, /bindtap="toggleCardFlip"/)
assert.match(template, /核心公式|变量含义|记忆提示/)
assert.match(template, /role="button"/)
assert.match(template, /aria-expanded="\{\{isFlipped\}\}"/)
assert.match(template, /onFormulaTouchStart/)
const cardWxss = fs.readFileSync(path.join(root, 'subpackages/formulas/components/formula-card/index.wxss'), 'utf8')
assert.match(cardWxss, /\.fc-flip-action\s*\{[^}]*align-self:\s*center;/,
  'the recitation answer action is horizontally centered in the card')
assert.match(template,
  /class="fc-example-notes" wx:if="\{\{ex\.solutionNodes\.length \|\| ex\.answerNodes\.length \|\| ex\.errorTipNodes\.length\}\}"/,
  'worked-example details share one semantic content group')
assert.match(cardWxss, /\.fc-example\s*\{[^}]*margin-top:\s*20rpx;[^}]*padding:\s*0;/,
  'the worked example stays on the formula card surface without another outer card')
assert.doesNotMatch(cardWxss, /\.fc-example\s*\{[^}]*(?:border|border-radius|background):/,
  'the worked-example question does not add a nested container')
assert.match(cardWxss, /\.fc-example-notes\s*\{[^}]*padding:\s*2rpx 16rpx;[^}]*border-radius:\s*12rpx;[^}]*background:\s*#F7FAF8;/,
  'solution, answer and trap blocks share one very light supporting surface')
assert.match(cardWxss, /\.fc-example-detail\s*\{[^}]*padding:\s*12rpx 0;[^}]*background:\s*transparent;/,
  'individual detail rows use spacing and separators instead of cards')
assert.match(cardWxss, /\.fc-flip-stage\.is-recite\s*\{[^}]*will-change:\s*transform;/)
assert.doesNotMatch(cardWxss, /\.fc-flip-stage\.is-flipped\s*\{[^}]*transform:/,
  'flip rotation must use the cumulative inline angle instead of a fixed class angle')
assert.match(cardWxss, /\.fc-flip-stage\.is-recite,\s*\.fc-flip-face\s*\{\s*transition: none !important;\s*will-change: auto !important;/)
assert.match(template, /class="fc-formula-line-scroll"/)
assert.match(template, /<page-container[\s\S]*bind:afterleave="onReadingAfterLeave"/)
assert.match(template, /duration="\{\{0\}\}" overlay="\{\{false\}\}"/)
assert.match(template, /custom-style="position:fixed;inset:0;width:100%;height:100%;background:transparent;"/)
const readingSheet = template.match(/<motion-sheet[^>]*>/)[0]
assert.match(readingSheet, /show="\{\{expandedVisible\}\}"/)
assert.match(readingSheet, /content-motion="fade"/)
assert.match(readingSheet, /safe-area="\{\{false\}\}"/)
assert.match(readingSheet, /bind:closed="onReadingClosed"/)
assert.doesNotMatch(readingSheet, /wx:if/)
assert.match(cardWxss, /@import\s+["']\.\.\/\.\.\/\.\.\/\.\.\/styles\/motion-sheet-panel\.wxss["']/)
assert.match(read('styles/motion-sheet-panel.wxss'), /\.motion-sheet-panel\.motion-sheet-panel\s*\{[^}]*transform:\s*none;/)
assert.equal(JSON.parse(read('subpackages/formulas/components/formula-card/index.json')).usingComponents['motion-sheet'], '/components/motion-sheet/index')
assert.match(template, /bindtouchstart="onFormulaTouchStart"/)
assert.match(template, /scroll-x data-scrollable="\{\{row\.canScrollX\}\}"/,
  'every formula row keeps native horizontal scrolling while only measured overflow claims reader swipes')
assert.doesNotMatch(template, /bind:afterenter|fitFormulaReading/)
assert.doesNotMatch(template, /height:90vh|>完成<|>展开阅读<|<button[^>]*fc-(?:reading-close|expand-button)/)
assert.match(template, /role="button" aria-label="关闭公式阅读"/)
const { fitReadingHeight, readingViewport, prepareReadingLayout } = require('../subpackages/formulas/utils/formula-reading-layout')
assert.deepEqual(readingViewport({ windowWidth: 375, windowHeight: 800 }), { width: 375, rpx: 0.5, maxHeight: 640, bottomInset: 0 })
assert.deepEqual(fitReadingHeight(70, 60, 640), { height: 130, scrollHeight: 70 })
assert.deepEqual(fitReadingHeight(900, 60, 640), { height: 640, scrollHeight: 580 })
assert.deepEqual(fitReadingHeight(250, 60, 640), { height: 310, scrollHeight: 250 })
// Geometry is resolved BEFORE visibility, using only existing reader nodes.
function queryFixture(rects, deferred) {
  return {
    selectAll() { return this }, select() { return this }, boundingClientRect() { return this },
    exec(callback) { if (deferred) deferred.push(() => callback(rects)); else callback(rects) },
  }
}
const viewport = readingViewport({ windowWidth: 375, windowHeight: 800 })
const fitting = [[{ width: 100, height: 40 }, { width: 100, height: 40 }], { height: 18 }, null]
let layout = prepareReadingLayout(runtimeFixture, fitting, viewport)
assert.equal(layout.expandedBlock.readingRows[0].lineItems.length, 1)
assert.equal(layout.expandedBlock.hasWideRows, false)
assert.equal('fullLineItem' in layout.expandedBlock.readingRows[0], false, 'panel payload excludes unused math trees')
assert.ok(layout.expandedHeight < 200, 'small content remains compact')
// Near the available-width boundary, the old 28→32 ratio would falsely split
// these identities. Both current font pairs must retain complete fitting rows.
for (const [windowWidth, fragmentWidth] of [[320, 130], [375, 151], [430, 174]]) {
  const fontViewport = readingViewport({ windowWidth, windowHeight: 844 })
  const dimensions = [[{ width: fragmentWidth, height: 40 }, { width: fragmentWidth, height: 40 }], { height: 22 }, null]
  const fittingLayout = prepareReadingLayout(runtimeFixture, dimensions, fontViewport)
  assert.equal(fittingLayout.expandedBlock.readingRows[0].lineItems.length, 1,
    'fitting identities stay complete at ' + windowWidth + 'px')
  assert.equal(fittingLayout.expandedBlock.hasWideRows, false)
  dimensions[0].forEach(rect => { rect.width += 20 })
  const wideLayout = prepareReadingLayout(runtimeFixture, dimensions, fontViewport)
  assert.equal(wideLayout.expandedBlock.readingRows[0].lineItems.length, 2,
    'genuinely wide identities still split safely at ' + windowWidth + 'px')
  assert.equal(wideLayout.expandedBlock.hasWideRows, true)
}
layout = prepareReadingLayout(runtimeFixture,
  [[{ width: 200, height: 900 }, { width: 500, height: 900 }], { height: 18 }, null], viewport)
assert.equal(layout.expandedBlock.readingRows[0].lineItems.length, 2)
assert.equal(layout.expandedHeight, viewport.maxHeight)
assert.equal(layout.expandedBlock.hasWideRows, true)
assert.deepEqual(readingViewport({ windowWidth: 375, windowHeight: 800, screenHeight: 844, safeArea: { bottom: 810 } }),
  { width: 375, rpx: 0.5, maxHeight: 640, bottomInset: 34 })
const deferred = []
target.data.formulaBlocks = [runtimeFixture]
target._readingLayouts = {}
target.writes = []
let queryCount = 0
target.createSelectorQuery = () => { queryCount++; return queryFixture(fitting, deferred) }
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
assert.equal(target.data.expandedBlock, null, 'native entry waits for final layout')
assert.equal(target.writes.length, 0, 'no provisional visible panel')
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
assert.equal(queryCount, 1, 'double-tap does not queue a second opening')
deferred.shift()()
assert.equal(target.writes.length, 1, 'final nodes and dimensions are supplied in ONE update')
assert.ok(target.writes[0].expandedHeight > 0)
assert.ok(target.writes[0].expandedHeaderHeight > 0)
assert.equal(target.data.expandedBlock.readingRows[0].lineItems.length, 1)
const cachedHeight = target.data.expandedHeight
target.closeFormulaReading()
target.onReadingClosed()
target.onReadingAfterLeave()
target.writes = []
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
assert.equal(queryCount, 1, 'reopening uses cached layout, not a new measurement')
assert.equal(target.data.expandedHeight, cachedHeight)
assert.equal(target.writes.length, 1)
target.closeFormulaReading()
target.onReadingClosed()
target.onReadingAfterLeave()
target._readingLayouts = {}
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
target.closeFormulaReading()
deferred.shift()()
assert.equal(target.data.expandedBlock, null, 'late measurement must not reopen a dismissed panel')
assert.equal(target._readingOpening, false)
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
definition.properties.card.observer.call(target, { id: 3, formula_blocks: [{ latex: 'x=z' }] }, { id: 2 })
deferred.shift()()
assert.equal(target.data.expandedBlock, null, 'card change cancels a pending opening')
const componentSource = read('subpackages/formulas/components/formula-card/index.js')
assert.match(componentSource, /isFlipped: false/)
assert.match(componentSource, /toggleCardFlip\(\)/)
assert.match(componentSource, /patch\.isFlipped = false/)
assert.doesNotMatch(template, /fc-detail-body|toggleSection/, 'browse and recitation share one complete content surface')
assert.doesNotMatch(read('subpackages/formulas/reader/index.wxml'), /fr-card-surface/, 'reader does not wrap the card in another card')
const readerStyles = read('subpackages/formulas/reader/index.wxss')
const libraryStyles = read('subpackages/formulas/library/index.wxss')
assert.match(readerStyles.slice(readerStyles.lastIndexOf('@media (prefers-reduced-motion: reduce)')),
  /\.fr-transition-stage,[\s\S]*transition: none !important/, 'reduced motion wins after the reader transition rules')
for (const [styles, control] of [[cardWxss, 'fc-flip-action'], [cardWxss, 'fc-expand-button'], [libraryStyles, 'fl-mode-tab'],
  [libraryStyles, 'fl-filter-button'], [libraryStyles, 'fl-search-clear'], [libraryStyles, 'fl-random-action'],
  [libraryStyles, 'fl-chapter-chip'], [libraryStyles, 'fl-study-type-chip'], [libraryStyles, 'fl-filter-option'],
  [libraryStyles, 'fl-filter-reset'], [libraryStyles, 'fl-filter-done'],
  [readerStyles, 'fr-card-favorite']]) {
  assert.match(styles, new RegExp('\\.' + control + '\\s*\\{[^}]*min-height:\\s*44px;'),
    control + ' keeps a 44px target on a 320px phone instead of shrinking with rpx')
}
assert.match(libraryStyles,
  /\.fl-filter-footer\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  'filter actions stay inside the sheet even when the native buttons reach their intrinsic width')
assert.match(libraryStyles, /\.fl-filter-reset\s*\{[^}]*min-width:\s*0;/)
assert.match(libraryStyles, /\.fl-filter-done\s*\{[^}]*min-width:\s*0;/)
for (const control of ['fc-flip-front-scroll', 'fc-flip-back-scroll']) {
  const tag = template.match(new RegExp('<scroll-view[^>]*class="' + control + '"[^>]*>'))[0]
  assert.doesNotMatch(tag, /(?:bind|catch)touch(?:start|end|cancel)/,
    'card vertical reading must let page swipe events bubble: ' + control)
  assert.match(tag, /scroll-y/, 'long content stays scrollable: ' + control)
  assert.match(tag, /show-scrollbar="\{\{false\}\}"/, 'reading scrollbars are hidden without clipping content: ' + control)
}
assert.doesNotMatch(read('subpackages/formulas/reader/index.wxml'), /fr-nav-capsule|fr-nav-hit|fr-nav-status/,
  'reader has no floating navigation capsule')
assert.doesNotMatch(readerStyles, /fr-nav-capsule|fr-nav-hit|fr-nav-status|fr-bottom-space/,
  'capsule layout and idle states are removed from the reader stylesheet')
assert.match(template, /class="fc-formula-line-scroll"[\s\S]*?bindtouchstart="onFormulaTouchStart"/,
  'actual horizontal formula scroll views still isolate card switching')
assert.match(readerStyles, /\.fr-transition-stage\s*\{[^}]*transform:\s*none\s*!important;/,
  'card changes stay opacity-only to avoid rich-text ghosts')
assert.doesNotMatch(read('subpackages/formulas/reader/index.wxml'), /route-enter-detail/,
  'reader ancestors must not inherit the global translated entrance animation')
const opening = componentSource.slice(componentSource.indexOf('    openFormulaReading('), componentSource.indexOf('    closeFormulaReading('))
assert.doesNotMatch(opening, /renderFormulaNodes|setTimeout/, 'click path never parses math or waits for animation')

for (const page of ['library', 'reader']) {
  assert.match(read(`subpackages/formulas/${page}/index.wxml`), /variant="mint"/)
  const config = JSON.parse(read(`subpackages/formulas/${page}/index.json`))
  assert.equal(config.backgroundColor, '#F3FBF8')
  assert.doesNotMatch(read(`subpackages/formulas/${page}/index.wxss`), /#(?:B7E82A|F4F4EE|C9F44D)/i)
}
console.log('Formula reader layout, math integrity, expanded reading and mint theme checks passed')

// Optional native WCC bundle: verifies template data and conditional branches,
// without a browser, screenshots, WeChat credentials or network access.
if (process.argv[2]) {
  const vm = require('node:vm')
  const native = vm.createContext({ window: { __webview_engine_version__: 0.02 }, console })
  vm.runInContext(fs.readFileSync(process.argv[2] === '-' ? 0 : process.argv[2], 'utf8'), native)
  function nativeRenderer(file) {
    const render = native.$gwx(file)
    return data => {
      // WCC checks constructors while cloning template values. Instantiate
      // fixtures in its realm, matching data received by the actual webview.
      native.fixtureJSON = JSON.stringify(data)
      return render(vm.runInContext('JSON.parse(fixtureJSON)', native))
    }
  }
  const renderCard = nativeRenderer('subpackages/formulas/components/formula-card/index.wxml')
  const renderReader = nativeRenderer('subpackages/formulas/reader/index.wxml')
  const renderLibrary = nativeRenderer('subpackages/formulas/library/index.wxml')
  const textNodes = text => [{ type: 'text', text }]
  const fixtureData = {
    ...structuredClone(definition.data),
    card: { id: 1, title: '根式积分与适用条件', studyCardTypeLabel: '公式', study_card_type: 'formula',
      tags: Array.from({ length: 8 }, (_, index) => ({ id: index, code: 'basic', name: '标签' + index })) },
    content: {
      titleNodes: textNodes('根式积分与适用条件'),
      summaryNodes: textNodes('记忆提示完整内容'), conditionsNodes: textNodes('适用条件完整内容'),
      symbolNotesNodes: textNodes('符号说明完整内容'), secondaryNodes: textNodes('结论完整内容'),
      errorTipsNodes: textNodes('易错提醒完整内容'),
      examples: Array.from({ length: 12 }, (_, index) => ({
        _key: 'ex-' + index, questionNodes: textNodes('例题题干' + index), solutionNodes: textNodes('解法' + index),
        answerNodes: textNodes('末尾答案' + index), errorTipNodes: textNodes('例题易错' + index),
      })),
    },
    formulaBlocks: [{ ...runtimeFixture, labelNodes: textNodes('积分公式'), noteNodes: textNodes('公式备注') }],
    recitationMode: false,
  }
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return []
    return [tree, ...(tree.children || []).flatMap(nodes)]
  }
  const byClass = (tree, name) => nodes(tree).filter(node => String(node.attr && node.attr.class || '').split(/\s+/).includes(name))
  function assertCompleteContent(tree) {
    assert.equal(byClass(tree, 'fc-formula-block').length, 1, 'formulas appear once on the main content face')
    assert.equal(byClass(tree, 'fc-formula-rich').length,
      runtimeFixture.readingRows.reduce((count, row) => count + row.lineItems.length, 0), 'all formula fragments survive template binding')
    assert.equal(byClass(tree, 'fc-example').length, 12, 'long content retains every example')
    const richNodes = nodes(tree).filter(node => node.tag === 'wx-rich-text').map(node => JSON.stringify(node.attr.nodes))
    for (const field of ['summaryNodes', 'conditionsNodes', 'symbolNotesNodes', 'secondaryNodes', 'errorTipsNodes']) {
      assert.equal(richNodes.filter(value => value === JSON.stringify(fixtureData.content[field])).length, 1, field)
    }
    assert.ok(richNodes.includes(JSON.stringify(fixtureData.content.examples.at(-1).answerNodes)), 'last answer remains reachable in the scroll content')
  }
  const browse = renderCard({ ...fixtureData, readingHeight: 600 })
  assert.equal(byClass(browse, 'fc-flip-face').length, 1, 'browse renders one main surface')
  assert.equal(byClass(browse, 'fc-flip-stage')[0].attr.style, '', 'browse keeps natural height even when the reader supplies viewport geometry')
  assert.equal(byClass(browse, 'fc-title-rich').length, 1)
  assert.equal(JSON.stringify(byClass(browse, 'fc-title-rich')[0].attr.nodes), JSON.stringify(fixtureData.content.titleNodes))
  assert.equal(byClass(browse, 'fc-tag').length, 9, 'all tags remain present')
  assert.equal(byClass(browse, 'fc-flip-action').length, 0)
  assertCompleteContent(browse)

    for (const expandedVisible of [true, false]) {
      const expanded = renderCard({ ...fixtureData, expandedBlock: runtimeFixture, expandedVisible,
        expandedHeight: 420, expandedHeaderHeight: 60, expandedScrollHeight: 360 })
      const nativeShell = nodes(expanded).find(node => node.tag === 'wx-page-container')
      const sheet = nodes(nativeShell).find(node => node.tag === 'wx-motion-sheet')
      assert.equal(nativeShell.attr.show, true, 'native Back shell survives the physical exit')
      assert.equal(nativeShell.attr.duration, 0)
      assert.equal(nativeShell.attr.overlay, false)
      assert.match(nativeShell.attr.customStyle, /height:100%;background:transparent/)
      assert.equal(sheet.attr.show, expandedVisible)
      assert.equal(sheet.attr.contentMotion, 'fade')
      assert.equal(sheet.attr.safeArea, false)
      assert.equal(sheet.attr['bind:closed'], 'onReadingClosed')
      assert.equal(byClass(sheet, 'fc-expanded-scroll')[0].attr.scrollY, true)
      assert.equal(byClass(sheet, 'fc-formula-line-scroll').every(node => node.attr.scrollX), true)
      assert.equal(byClass(expanded, 'fc-flip-stage').some(stage => nodes(stage).includes(nativeShell)), false)
    }

  for (const isFlipped of [false, true]) {
    const flipAngle = isFlipped ? 180 : 360
    const recite = renderCard({ ...fixtureData, recitationMode: true, readingHeight: 600, isFlipped, flipAngle })
    const front = byClass(recite, 'fc-flip-front')[0]
    const back = byClass(recite, 'fc-flip-back')[0]
    assert.equal(byClass(recite, 'fc-flip-face').length, 2)
    assert.match(byClass(recite, 'fc-flip-stage')[0].attr.style,
      new RegExp(`transform:rotateY\\(${flipAngle}deg\\);height:600px;`),
      'both faces use the current cumulative transform and reader viewport')
    assert.equal(front.attr.ariaHidden, isFlipped)
    assert.equal(back.attr.ariaHidden, !isFlipped)
    assert.equal(byClass(front, 'fc-formula-rich').length, 0, 'prompt does not expose answer content')
    assert.equal(byClass(front, 'fc-flip-action')[0].attr.ariaLabel, '显示答案')
    assert.equal(byClass(front, 'fc-flip-action')[0].attr.disabled, isFlipped)
    assert.equal(byClass(back, 'fc-flip-action')[0].attr.ariaLabel, '返回题面')
    assert.equal(byClass(back, 'fc-flip-action')[0].attr.disabled, !isFlipped)
    assertCompleteContent(back)
  }

  const empty = { ...fixtureData, formulaBlocks: [], content: { ...structuredClone(definition.data.content) } }
  assert.equal(byClass(renderCard(empty), 'fc-content-empty').length, 1)
  const graph = { ...empty, card: { ...empty.card, card_type: 'function_graph' }, graphImageUrl: 'fixture-graph.png', displayGraphUrl: 'fixture-thumbnail.png' }
  assert.equal(byClass(renderCard(graph), 'fc-graph-image')[0].attr.src, 'fixture-thumbnail.png')
  assert.equal(byClass(renderCard(graph), 'fc-content-empty').length, 0)
  assert.equal(byClass(renderCard({ ...graph, graphLoadError: true }), 'fc-graph-fallback').length, 1)
  assert.equal(byClass(renderCard({ ...graph, graphImageUrl: '', displayGraphUrl: '' }), 'fc-graph-fallback').length, 1)
  for (const graphLoadError of [false, true]) {
    const graphTree = renderCard({ ...graph, graphLoadError, graphViewportRatio: 75 })
    assert.equal(byClass(graphTree, 'fc-graph-viewport')[0].attr.style, 'padding-bottom:75%;',
      'image loading and failure retain exactly the same reserved viewport')
  }
  const swipeReader = renderReader({ ...readerDefinition.data, loading: false, currentCard: fixtureData.card,
    sequenceIds: [1, 2, 3], sequenceIndex: 0, canGoPrev: false, canGoNext: true })
  assert.equal(byClass(swipeReader, 'fr-nav-capsule').length, 0,
    'native reader template contains no floating switching capsule')

  for (const recitationMode of [false, true]) {
    const readerTree = renderReader({ ...readerDefinition.data, loading: false, currentCard: fixtureData.card, recitationMode, recitationHeight: 600 })
    const card = nodes(readerTree).find(node => node.attr && node.attr.id === 'readerFormulaCard')
    assert.equal(card.attr.recitationMode, recitationMode, 'reader passes its chosen mode to the card')
    assert.equal(card.attr.readingHeight, 600, 'reader passes its actual available height to the card')
    assert.equal(byClass(readerTree, 'fr-card-scroll')[0].attr.scrollY, !recitationMode, 'recitation scrolls long content inside the card')
    assert.equal(byClass(readerTree, 'fr-mode-tab').length, 0, 'mode settings live in the library')
    assert.equal(byClass(readerTree, 'fr-mode-label').length, 1)
    for (const showMoreSheet of [false, true]) {
      const libraryTree = renderLibrary({ initialLoading: false, activeLibraryType: 'formula', activeSubject: 'exam408',
        activeTags: [], _shownActiveTags: [], formulas: [], chapters: [{ id: 12, name: '算法分析', active: false }],
        studyTypeTabs: [{ key: '', name: '全部', active: true }, { key: 'formula', name: '公式', active: false }],
        recitationMode, showMoreSheet })
      const tabs = byClass(libraryTree, 'fl-mode-tab')
      assert.equal(tabs.length, 2, 'reading mode remains directly available with filters closed and is never duplicated in the sheet')
      assert.equal(tabs[0].attr.ariaPressed, !recitationMode)
      assert.equal(tabs[1].attr.ariaPressed, recitationMode)
      assert.equal(byClass(libraryTree, 'fl-filter-button')[0].attr.ariaExpanded, showMoreSheet)
        const filterSheet = nodes(libraryTree).find(node => node.tag === 'wx-motion-sheet' && node.attr.label === '筛选')
        assert.equal(filterSheet.attr.show, showMoreSheet, 'persistent filter wrapper delegates visibility to motion-sheet')
        assert.equal(byClass(filterSheet, 'fl-chapter-chip').length, 2, 'chapter choices survive a physical close')
        assert.equal(byClass(filterSheet, 'fl-study-type-chip').length, 2, '408 choices remain available inside the filters')
      if (showMoreSheet) assert.equal(byClass(libraryTree, 'fl-filter-body')[0].attr.scrollY, true, 'filter choices scroll on short phones')
    }
  }
  const filteredLibrary = renderLibrary({ initialLoading: false, activeLibraryType: 'formula', activeSubject: 'exam408',
    formulas: [], chapters: [{ id: 12, name: '算法分析', active: true }], activeChapterId: 12,
    studyTypeTabs: [{ key: 'formula', name: '公式', active: true }], activeStudyCardType: 'formula',
    activeTags: [1], _shownActiveTags: [{ id: 1, name: '高频' }], onlyFavorites: true })
  assert.equal(byClass(filteredLibrary, 'fl-active-tag').length, 4, 'applied chapter, content type, favorites and tag remain visible and removable')
  assert.equal(byClass(filteredLibrary, 'fl-filter-dot').length, 1)
  const guestFilters = renderLibrary({ initialLoading: false, formulas: [], activeTags: [], _shownActiveTags: [], showMoreSheet: true, guestMode: true })
  assert.equal(byClass(guestFilters, 'fl-filter-option')[0].attr.disabled, true, 'guest filters cannot issue favorite requests')
  console.log('Native WXML mode, single-surface, complete-content and graph/empty branch checks passed')
}

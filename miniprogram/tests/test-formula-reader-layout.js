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
target.closeFormulaReading()
target.closeFormulaReading() // Native afterleave may fire after the close button.
assert.equal(target.data.expandedBlock, null)
assert.deepEqual(target.events, ['formulastart', 'readingchange', 'readingchange', 'formulaend'])
target.openFormulaReading({ currentTarget: { dataset: { index: 99 } } })
assert.equal(target.data.expandedBlock, null)
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
definition.properties.card.observer.call(target, { id: 2, formula_blocks: [{ latex: 'x=y' }] }, { id: 1 })
assert.equal(target.data.expandedBlock, null, 'switching card dismisses stale expanded content')
assert.equal(target.events.at(-1), 'formulaend')
assert.equal(target.data.formulaBlocks[0].readingRows[0].lineItems.length, 1)
assert.match(read('subpackages/formulas/reader/index.wxml'), /currentCard && !formulaReadingExpanded/)
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
assert.match(cardWxss, /\.fc-flip-stage\.is-recite\s*\{[^}]*will-change:\s*transform;/)
assert.match(cardWxss, /\.fc-flip-stage\.is-recite,\s*\.fc-flip-face\s*\{\s*transition: none !important;\s*will-change: auto !important;/)
assert.match(template, /class="fc-formula-line-scroll"/)
assert.match(template, /<page-container[\s\S]*bind:afterleave="closeFormulaReading"/)
assert.match(template, /bindtouchstart="onFormulaTouchStart"/)
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
target.writes = []
target.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
assert.equal(queryCount, 1, 'reopening uses cached layout, not a new measurement')
assert.equal(target.data.expandedHeight, cachedHeight)
assert.equal(target.writes.length, 1)
target.closeFormulaReading()
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
  [libraryStyles, 'fl-settings-button'], [libraryStyles, 'fl-search-clear'],
  [readerStyles, 'fr-card-favorite'], [readerStyles, 'fr-nav-hit']]) {
  assert.match(styles, new RegExp('\\.' + control + '\\s*\\{[^}]*min-height:\\s*44px;'),
    control + ' keeps a 44px target on a 320px phone instead of shrinking with rpx')
}
for (const control of ['fc-flip-front-scroll', 'fc-flip-back-scroll']) {
  const tag = template.match(new RegExp('<scroll-view[^>]*class="' + control + '"[^>]*>'))[0]
  assert.doesNotMatch(tag, /(?:bind|catch)touch(?:start|end|cancel)/,
    'card vertical reading must let page swipe events bubble: ' + control)
}
assert.match(template, /class="fc-formula-line-scroll"[\s\S]*?bindtouchstart="onFormulaTouchStart"/,
  'actual horizontal formula scroll views still isolate card switching')
assert.match(readerStyles, /\.fr-transition-stage\s*\{[^}]*transform:\s*none\s*!important;/,
  'card changes stay opacity-only to avoid rich-text ghosts')
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
  vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), native)
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
  const browse = renderCard(fixtureData)
  assert.equal(byClass(browse, 'fc-flip-face').length, 1, 'browse renders one main surface')
  assert.equal(byClass(browse, 'fc-title-rich').length, 1)
  assert.equal(JSON.stringify(byClass(browse, 'fc-title-rich')[0].attr.nodes), JSON.stringify(fixtureData.content.titleNodes))
  assert.equal(byClass(browse, 'fc-tag').length, 9, 'all tags remain present')
  assert.equal(byClass(browse, 'fc-flip-action').length, 0)
  assertCompleteContent(browse)

  for (const isFlipped of [false, true]) {
    const recite = renderCard({ ...fixtureData, recitationMode: true, isFlipped })
    const front = byClass(recite, 'fc-flip-front')[0]
    const back = byClass(recite, 'fc-flip-back')[0]
    assert.equal(byClass(recite, 'fc-flip-face').length, 2)
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

  for (const recitationMode of [false, true]) {
    const readerTree = renderReader({ ...readerDefinition.data, loading: false, currentCard: fixtureData.card, recitationMode })
    const card = nodes(readerTree).find(node => node.attr && node.attr.id === 'readerFormulaCard')
    assert.equal(card.attr.recitationMode, recitationMode, 'reader passes its chosen mode to the card')
    assert.equal(byClass(readerTree, 'fr-mode-tab').length, 0, 'mode settings live in the library')
    assert.equal(byClass(readerTree, 'fr-mode-label').length, 1)
    const libraryTree = renderLibrary({ initialLoading: false, activeLibraryType: 'formula',
      activeTags: [], formulas: [], recitationMode, showMoreSheet: true })
    const tabs = byClass(libraryTree, 'fl-mode-tab')
    assert.equal(tabs.length, 2)
    assert.equal(tabs[0].attr.ariaPressed, !recitationMode)
    assert.equal(tabs[1].attr.ariaPressed, recitationMode)
  }
  console.log('Native WXML mode, single-surface, complete-content and graph/empty branch checks passed')
}

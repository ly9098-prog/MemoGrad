const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const originalWx = global.wx
global.wx = { getWindowInfo: () => ({ windowWidth: 375 }), getDeviceInfo: () => ({ system: 'Node.js' }) }
after(() => { global.wx = originalWx })

let definition
const originalComponent = global.Component
global.Component = value => { definition = value }
require('../subpackages/formulas/components/formula-card/index')
global.Component = originalComponent

function cardInstance(recitationMode = false) {
  return {
    ...definition.methods,
    data: { ...structuredClone(definition.data), recitationMode },
    writes: [], events: [],
    setData(patch, callback) {
      this.writes.push(patch)
      Object.assign(this.data, patch)
      if (callback) callback()
    },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
}

function changeCard(instance, nextCard) {
  const previousCard = instance.data.card
  instance.data.card = nextCard
  definition.properties.card.observer.call(instance, nextCard, previousCard)
}

function changeMode(instance, recitationMode) {
  const previousMode = instance.data.recitationMode
  instance.data.recitationMode = recitationMode
  definition.properties.recitationMode.observer.call(instance, recitationMode, previousMode)
}

test('browsing is the default and cannot accidentally flip', () => {
  const card = cardInstance()
  assert.equal(definition.properties.recitationMode.value, false)
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false)
  assert.equal(card.writes.length, 0)
})

test('recitation flips the same prepared content and returns to the prompt', () => {
  const card = cardInstance(true)
  const formulas = [{ readingRows: [{ lineItems: [{ mathNodes: [{ type: 'text', text: 'x = y' }] }] }] }]
  card.data.formulaBlocks = formulas
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, true)
  assert.equal(card.data.formulaBlocks, formulas)
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false)
  card.data.expandedBlock = {}
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false, 'expanded native reading owns the interaction')
  card.data.expandedBlock = null
  card._readingOpening = true
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false, 'pending native reading also owns the interaction')
})

test('swiping, multi-touch and cancellation cannot accidentally flip the card', () => {
  for (const action of ['swipe', 'multi', 'cancel']) {
    const card = cardInstance(true)
    card.onCardTouchStart({ touches: [{ clientX: 180, clientY: 80 }] })
    if (action === 'swipe') card.onCardTouchEnd({ changedTouches: [{ clientX: 100, clientY: 81 }] })
    if (action === 'multi') card.onCardTouchMove({ touches: [{ clientX: 180, clientY: 80 }, { clientX: 200, clientY: 80 }] })
    if (action === 'cancel') card.onCardTouchCancel()
    card.toggleCardFlip()
    assert.equal(card.data.isFlipped, false, action)
    card._flipTapSuppressedUntil = 0
    card.onCardTouchStart({ touches: [{ clientX: 100, clientY: 80 }] })
    card.onCardTouchEnd({ changedTouches: [{ clientX: 102, clientY: 81 }] })
    card.toggleCardFlip()
    assert.equal(card.data.isFlipped, true, 'a normal tap still works')
  }
})

test('updating the same card content resets its face and stale gesture state', () => {
  const card = cardInstance(true)
  const original = { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] }
  changeCard(card, original)
  card.toggleCardFlip()
  card.data.recitationScrollTop = 900
  card.writes = []
  card._flipGesture = { x: 100, y: 80 }
  card._flipTapSuppressedUntil = Date.now() + 500
  const updated = { ...original, title: '乘法法则', formula_blocks: [{ latex: 'a b = b a' }] }
  changeCard(card, updated)
  assert.equal(card.data.isFlipped, false)
  assert.equal(card._flipTapSuppressedUntil, 0)
  assert.equal(card._flipGesture, null)
  assert.ok(card.data.formulaBlocks[0].readingRows.length)
  assert.deepEqual(card.writes.filter(patch => 'recitationScrollTop' in patch),
    [{ recitationScrollTop: 1 }, { recitationScrollTop: 0 }], 'new content starts at the top of either face')
})

test('switching cards resets the answer while favorite metadata keeps the current face', () => {
  const card = cardInstance(true)
  const original = { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] }
  changeCard(card, original)
  card.toggleCardFlip()
  const formulas = card.data.formulaBlocks
  changeCard(card, { ...original, isFavorited: true })
  assert.equal(card.data.isFlipped, true)
  assert.equal(card.data.formulaBlocks, formulas, 'favorite updates do not reparse formulas')
  changeCard(card, { ...original, id: 2 })
  assert.equal(card.data.isFlipped, false)
  assert.equal(card.data.recitationMode, true, 'card navigation preserves the chosen mode')
})

test('changing modes resets the face and cancels stale expanded reading measurements', () => {
  const card = cardInstance(true)
  changeCard(card, { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] })
  const formulas = card.data.formulaBlocks
  card.toggleCardFlip()
  let measured
  const query = {
    selectAll() { return this }, select() { return this }, boundingClientRect() { return this },
    exec(callback) { measured = callback },
  }
  card.createSelectorQuery = () => query
  card.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(card._readingOpening, true)
  card._flipGesture = { x: 100, y: 80 }
  card._flipTapSuppressedUntil = Date.now() + 500
  changeMode(card, false)
  measured([])
  assert.equal(card._readingOpening, false)
  assert.equal(card.data.expandedBlock, null)
  assert.equal(card.data.isFlipped, false)
  assert.equal(card._flipGesture, null)
  assert.equal(card._flipTapSuppressedUntil, 0)
  assert.equal(card.data.formulaBlocks, formulas, 'mode changes reuse prepared math nodes')
  assert.deepEqual(card._readingLayouts, {})
  assert.equal(card.events.at(-1).name, 'formulaend')
  changeMode(card, true)
  card.toggleCardFlip()
  card.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
  measured([])
  assert.ok(card.data.expandedBlock)
  changeMode(card, false)
  assert.equal(card.data.expandedBlock, null)
  assert.equal(card.events.at(-2).name, 'readingchange')
  assert.equal(card.events.at(-2).detail.expanded, false)
})

let readerDefinition
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../subpackages/formulas/reader/index.js'), 'utf8'), {
  require: () => ({}), Page: value => { readerDefinition = value }, console,
  clearTimeout() {}, setTimeout(callback) { callback(); return 1 },
})

function readerInstance() {
  return {
    ...readerDefinition,
    data: structuredClone(readerDefinition.data),
    _readerAlive: true,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  }
}
const modeEvent = mode => ({ currentTarget: { dataset: { mode } } })

test('reader mode is independent of random drawing, the current card and its sequence', () => {
  for (const isRandom of [false, true]) {
    const reader = readerInstance()
    const card = { id: 2, title: '乘法' }
    const ids = [1, 2, 3]
    Object.assign(reader.data, { isRandom, currentCard: card, sequenceIds: ids, sequenceIndex: 1,
      currentIndex: 1, displayCards: [{ id: 1 }, card], readerScrollTop: 900 })
    assert.equal(reader.data.recitationMode, false)
    reader._readerGesture = { dx: 90 }
    reader._formulaGestureActive = true
    reader.setReaderMode(modeEvent('recite'))
    assert.equal(reader.data.recitationMode, true)
    assert.equal(reader.data.currentCard, card)
    assert.equal(reader.data.sequenceIds, ids)
    assert.equal(reader.data.sequenceIndex, 1)
    assert.equal(reader.data.currentIndex, 1)
    assert.equal(reader.data.readerScrollTop, 0)
    assert.equal(reader._readerGesture, null)
    assert.equal(reader._formulaGestureActive, false)
    reader.setReaderMode(modeEvent('browse'))
    assert.equal(reader.data.recitationMode, false)
  }
})

test('mode controls ignore invalid, duplicate, loading and expanded-reading actions', () => {
  const reader = readerInstance()
  for (const mode of ['', 'random', 'browse']) {
    reader.data.readerScrollTop = 900
    reader.setReaderMode(modeEvent(mode))
    assert.equal(reader.data.recitationMode, false)
    assert.equal(reader.data.readerScrollTop, 900)
  }
  for (const guard of ['loadingNext', 'formulaReadingExpanded']) {
    reader.data[guard] = true
    reader.setReaderMode(modeEvent('recite'))
    assert.equal(reader.data.recitationMode, false, guard)
    reader.data[guard] = false
  }
})

test('ordered and random navigation retain recitation mode', () => {
  const ordered = readerInstance()
  Object.assign(ordered.data, { recitationMode: true, currentCard: { id: 2 }, sequenceIds: [1, 2, 3], sequenceIndex: 1 })
  ordered.syncNavigationState()
  const requests = []
  ordered.loadCard = (...args) => requests.push(args)
  ordered.goPrev()
  ordered.goNext()
  assert.deepEqual(requests.map(args => args[0]), [1, 3])
  assert.equal(ordered.data.recitationMode, true)

  const random = readerInstance()
  const first = { id: 1 }
  const second = { id: 2 }
  Object.assign(random.data, { isRandom: true, recitationMode: true, displayCards: [first, second], currentCard: second, currentIndex: 1 })
  random.syncNavigationState()
  random.goPrev()
  assert.equal(random.data.currentCard, first)
  assert.equal(random.data.recitationMode, true)
  random.goNext()
  assert.equal(random.data.currentCard, second)
  assert.equal(random.data.recitationMode, true)
})

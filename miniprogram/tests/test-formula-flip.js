const assert = require('node:assert/strict')
const { test, after } = require('node:test')

const originalWx = global.wx
global.wx = { getWindowInfo: () => ({ windowWidth: 375 }), getDeviceInfo: () => ({ system: 'Node.js' }) }
after(() => { global.wx = originalWx })

let definition
const originalComponent = global.Component
global.Component = value => { definition = value }
require('../subpackages/formulas/components/formula-card/index')
global.Component = originalComponent

function cardInstance() {
  return {
    ...definition.methods,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent() {},
  }
}

test('formula flip preserves prepared nodes and reverses on the next tap', () => {
  const card = cardInstance()
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
})

test('swiping, multi-touch and cancellation cannot accidentally flip the card', () => {
  for (const action of ['swipe', 'multi', 'cancel']) {
    const card = cardInstance()
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
  const card = cardInstance()
  card._syncGraphViewportRatio = () => {}
  const original = { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] }
  definition.properties.card.observer.call(card, original, {})
  card.toggleCardFlip()
  card._flipTapSuppressedUntil = Date.now() + 500
  const updated = { ...original, title: '乘法法则', formula_blocks: [{ latex: 'a b = b a' }] }
  definition.properties.card.observer.call(card, updated, original)
  assert.equal(card.data.isFlipped, false)
  assert.equal(card._flipTapSuppressedUntil, 0)
  assert.ok(card.data.formulaBlocks[0].readingRows.length)
})

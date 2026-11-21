const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runtime } = require('./helpers/physical-motion-runtime')

test('physical solver converges consistently at 30, 60 and 120Hz', () => {
  const p = runtime('utils/motion-physics.wxs').motion
  const outcomes = [30,60,120].map(hz => {
    let state = { x: 0, v: 0 }
    for (let i = 0; i < hz; i++) state = p.spring(state.x, state.v, 1, 1 / hz, 500, 45)
    return state.x
  })
  outcomes.forEach(x => assert.ok(Math.abs(x - 1) < 0.000001))
  assert.ok(Math.max(...outcomes) - Math.min(...outcomes) < 1e-8)
  assert.ok(p.rubber(-1000, 0, 500, 500) > -500)
  assert.equal(p.rubber(100, 0, 500, 500), 100)
  assert.equal(p.snap(60, 0, [0,112,400]), 112)
  assert.equal(p.snap(60, 2100, [0,112,400]), 400)
})

test('capsule morph reverses in flight, preserves layout and becomes inert on hide', () => {
  const h = runtime('components/motion-sheet/sheet-motion.wxs')
  const model = { active: true, id: 1, panel: { left: 0, top: 500, width: 390, height: 344 }, origin: { left: 32, top: 180, width: 120, height: 44 } }
  h.motion.sync(model, null, h.owner)
  h.tick(); h.tick()
  assert.ok(h.state.p > 0 && h.state.p < 1)
  h.motion.sync({ ...model, close: true }, model, h.owner)
  h.flush()
  assert.equal(h.state.p, 0)
  h.motion.sync(model, { ...model, close: true }, h.owner); h.flush()
  assert.equal(h.state.p, 1)
  assert.match(h.node('.motion-sheet-surface').style.transform, /scale\(1,1\)/)
  assert.deepEqual(h.calls.map(c => c.name), ['finishClose'])
  h.motion.sync({ active: false }, model, h.owner)
  const writes = h.node('.motion-sheet-surface').writes
  h.flush()
  assert.equal(h.node('.motion-sheet-surface').writes, writes)
})

test('drawer velocity chooses an anchor, touchcancel restores full height, close publishes once', () => {
  const h = runtime('components/motion-sheet/sheet-motion.wxs')
  h.motion.sync({ active: true, immediate: true, id: 1, panel: { left: 0, top: 500, width: 390, height: 344 }, origin: { left: 32, top: 180, width: 120, height: 44 } }, null, h.owner)
  h.flush()
  h.motion.start(h.event(100, 500), h.owner)
  for (let i = 0; i < 10; i++) { h.tick(); h.motion.move(h.event(100, 500 + i * 14), h.owner) }
  assert.equal(h.calls.length, 0, 'no per-frame bridge')
  h.motion.cancel(h.event(null, null, 'touchcancel'), h.owner); h.flush()
  assert.equal(h.state.y, 0)
  h.motion.start(h.event(100, 500), h.owner)
  for (let i = 0; i < 10; i++) { h.tick(); h.motion.move(h.event(100, 500 + i * 30), h.owner) }
  h.motion.end(h.event(null, null, 'touchend'), h.owner); h.flush()
  assert.deepEqual(h.calls.map(c => c.name), ['dismissFromGesture'])
  assert.equal(h.calls[0].detail.id, 1, 'dismissal carries the measured command identity across the bridge')
})

test('finished drawer gesture removes its hit layer immediately and emits completion once', () => {
  let definition
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../components/motion-sheet/index.js'), 'utf8')
  require('node:vm').runInNewContext(source, { Component: value => { definition = value }, clearTimeout })
  const events = []
  const sheet = { ...definition.methods, _attached: true, _sequence: 1,
    properties: { show: true, closing: false }, data: { rendered: true, command: { active: true, id: 1 } },
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { if (name === 'close') events.push({ name, completed: detail.completed }) } }
  sheet.dismissFromGesture({ id: 1 })
  sheet.dismissFromGesture({ id: 1 })
  assert.equal(sheet.data.rendered, false)
  assert.equal(sheet.data.command.active, false)
  assert.deepEqual(events, [{ name: 'close', completed: true }])
})

test('closing from an interrupted drag returns exactly to the capsule with no stale gesture', () => {
  const h = runtime('components/motion-sheet/sheet-motion.wxs')
  const model = { active: true, anchored: true, immediate: true, id: 1, panel: { left: 0, top: 500, width: 390, height: 344 }, origin: { left: 32, top: 180, width: 120, height: 44 } }
  h.motion.sync(model, null, h.owner); h.flush()
  h.motion.start(h.event(100,500), h.owner)
  h.tick(); h.motion.move(h.event(100,600), h.owner); h.tick()
  h.motion.sync({ ...model, close: true }, model, h.owner); h.flush()
  assert.equal(h.state.p, 0)
  assert.equal(h.state.gesture, null)
  assert.equal(h.node('.motion-sheet-shell').style.transform, 'translate3d(0,0px,0)')
})

test('button compresses to .96 and release overshoots, cancel always restores', () => {
  const h = runtime('utils/press-motion.wxs')
  h.motion.start(h.event(10, 10), h.owner); h.flush()
  assert.equal(h.state.press.x, .96)
  assert.match(h.node('button').style['box-shadow'], /inset 0 2px/)
  h.motion.end(h.event(null, null, 'touchcancel'), h.owner)
  let max = 1
  for (let i = 0; h.frames.length && i < 160; i++) { h.tick(); max = Math.max(max, h.state.press.x) }
  assert.ok(max > 1 && max < 1.02)
  assert.equal(h.state.press.x, 1)
  assert.equal(h.node('button').style['box-shadow'], '0 2px 8px rgba(12,49,35,0.05)', 'release restores the original card elevation')
  assert.equal(h.calls.length, 0)
})

test('shared transition runs forward and back, interruption cancels queued frames', () => {
  const h = runtime('components/shared-card-transition/shared-motion.wxs')
  const model = { active: true, width: 390, height: 844, origin: { left: 16, top: 290, width: 358, height: 144 } }
  h.motion.sync(model,null,h.owner); h.flush()
  assert.equal(h.state.p,1)
  assert.deepEqual(h.calls.map(c => c.name), ['arrived'])
  h.motion.sync({ ...model, close: true }, model,h.owner); h.flush()
  assert.equal(h.state.p,0)
  assert.deepEqual(h.calls.map(c => c.name), ['arrived','departed'])
  h.motion.sync(model,{ ...model, close: true },h.owner)
  h.tick(); h.motion.sync({ active:false },model,h.owner); h.flush()
  assert.equal(h.calls.length,2)
})


test('a delayed dismissal cannot close a newly measured drawer after hide and show', () => {
  let definition
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../components/motion-sheet/index.js'), 'utf8')
  require('node:vm').runInNewContext(source, { Component: value => { definition = value }, clearTimeout })
  const events = []
  const sheet = { ...definition.methods, _attached: true, _sequence: 3,
    properties: { show: true, closing: false }, data: { rendered: true, command: { active: true, id: 3 } },
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { if (name === 'close') events.push({ name, completed: detail.completed }) } }
  sheet.dismissFromGesture({ id: 1 })
  assert.equal(sheet.data.rendered, true)
  assert.equal(events.length, 0)
  sheet.dismissFromGesture({ id: 3 })
  assert.equal(sheet.data.rendered, false)
  assert.equal(events.length, 1)
})

test('Dock capsule expands continuously with one small overshoot and reverses without a reset', () => {
  const h = runtime('components/motion-sheet/sheet-motion.wxs')
  const model = { active: true, anchored: true, dock: true, id: 1,
    panel: { left: 0, top: 500, width: 390, height: 344 }, origin: { left: 32, top: 180, width: 120, height: 44 } }
  h.motion.sync(model, null, h.owner)
  let peak = 0
  for (let frame = 0; h.frames.length && frame < 160; frame++) { h.tick(); peak = Math.max(peak, h.state.p) }
  assert.ok(peak > 1.01 && peak < 1.06, `bounded Dock rebound: ${peak}`)
  assert.equal(h.state.p, 1)
  assert.equal(h.node('.motion-sheet-surface').style['border-radius'], '24px 24px 0px 0px / 24px 24px 0px 0px')
  h.motion.sync({ ...model, close: true }, model, h.owner)
  h.tick(); h.tick()
  const before = h.state.p
  h.motion.sync({ ...model, id: 2, resume: true }, { ...model, close: true }, h.owner)
  assert.equal(h.state.p, before, 'reversal retains the instantaneous position')
  h.flush()
  assert.equal(h.state.p, 1)
})

test('rich-text bodies keep all ancestors untransformed while the surface and handle track drag', () => {
  const h = runtime('components/motion-sheet/sheet-motion.wxs')
  const model = { active: true, immediate: true, fade: true, id: 1,
    panel: { left: 0, top: 500, width: 390, height: 344 }, origin: { left: 0, top: 844, width: 390, height: 344 } }
  h.motion.sync(model, null, h.owner); h.flush()
  h.motion.start(h.event(100, 500), h.owner)
  h.tick(); h.motion.move(h.event(100, 620), h.owner); h.tick()
  assert.equal(h.node('.motion-sheet-shell').style.transform, 'none')
  assert.equal(h.node('.motion-sheet-content').style.transform, undefined)
  assert.equal(h.node('.motion-sheet-body').style.transform, undefined)
  assert.match(h.node('.motion-sheet-surface').style.transform, /120px/)
  assert.match(h.node('.motion-sheet-grip').style.transform, /120px/)
  assert.ok(h.node('.motion-sheet-body').style.opacity < 1)
  assert.equal(h.node('.motion-sheet-body').style['clip-path'], 'inset(92px 0 0)',
    'stationary text above the moving surface is hidden below the 28px grip')
  h.motion.sync({ ...model, id: 2, resume: true, resetDrag: true, dismissible: false }, model, h.owner)
  h.flush()
  assert.equal(h.state.y, 0, 'a new save lock restores the fully visible body')
  assert.equal(h.node('.motion-sheet-body').style.opacity, 1)
  assert.equal(h.node('.motion-sheet-body').style['clip-path'], 'none',
    'fully restored math and native scrolling are not clipped')
})

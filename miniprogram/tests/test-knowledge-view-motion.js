const assert = require('node:assert/strict')
const { test } = require('node:test')
const { motionFixture } = require('./support/knowledge-motion')
const { clampCamera, zoomCamera } = require('../subpackages/knowledge/knowledge-subject/graph-layout')

test('120 pan frames update only the view transform and commit once on release', () => {
  const h = motionFixture()
  const geometryWrites = () => h.styles.filter(row => /node|edge/.test(row.name)).length
  const initialGeometry = geometryWrites()
  h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
  for (let index = 1; index <= 120; index++) {
    h.motion.move(h.event([h.touch(100 + index, 100 + index / 2)]), h.owner)
    assert.equal(h.calls.length, 0)
    h.tick()
  }
  assert.equal(geometryWrites(), initialGeometry, 'panning never rewrites nodes or edges')
  h.motion.end(h.event([], 'touchcancel'), h.owner)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].name, 'commitGraphMotion')
  assert.deepEqual(h.calls[0].args.camera, clampCamera({ ...h.model.camera, x: h.model.camera.x + 120, y: h.model.camera.y + 60 }, h.rect))
  assert.equal(h.classes.has('graph-interacting'), false)
})

test('burst touch events share a view frame and the final node position retains finger offset', () => {
  const h = motionFixture(), initial = h.model.nodes[1], camera = h.model.camera
  const x = camera.x + initial.cx * camera.scale + 8
  const y = camera.y + initial.cy * camera.scale - 6
  h.motion.nodeStart(h.event([h.touch(x, y)], 'touchstart', initial.id), h.owner)
  h.motion.start(h.event([h.touch(x, y)], 'touchstart'), h.owner)
  const prior = h.styles.length
  for (let index = 1; index <= 40; index++) h.motion.move(h.event([h.touch(x + index, y + index / 2)]), h.owner)
  assert.equal(h.frames.length, 1)
  assert.equal(h.styles.length, prior)
  assert.equal(h.calls.length, 0)
  h.motion.end(h.event([], 'touchend'), h.owner)
  assert.deepEqual(h.calls[0].args.node, { id: initial.id, cx: 350, cy: 325 })
  assert.ok(h.styles.some(row => row.name === 'edge0' && row.value.transform.startsWith('rotate(')))
})

test('pinch matches authoritative zoom geometry and keeps screen labels and hit targets stable', () => {
  for (const width of [320, 390, 430]) {
    const h = motionFixture({ rect: { width, height: width * 660 / 702 } })
    h.motion.start(h.event([h.touch(100, 100), h.touch(200, 100)], 'touchstart'), h.owner)
    h.motion.move(h.event([h.touch(50, 100), h.touch(250, 100)]), h.owner)
    h.tick()
    const expected = zoomCamera(h.model.camera, 2, { x: 150, y: 100 }, h.rect)
    for (const key of ['x', 'y', 'scale']) assert.ok(Math.abs(h.state.camera[key] - expected[key]) < 1e-9, key)
    assert.equal(Number.parseFloat(h.stage.style['--graph-hit-size']) * expected.scale, 44)
    assert.equal(Number.parseFloat(h.stage.style['font-size']), Math.max(8, Math.min(48, 12 / expected.scale)))
    assert.equal(h.calls.length, 0)
    h.motion.end(h.event([], 'touchend'), h.owner)
    assert.equal(h.calls.length, 1)
  }
})

test('changing finger count rebases the gesture without carrying node drag into pinch or pan', () => {
  const h = motionFixture()
  h.motion.nodeStart(h.event([h.touch(100, 100)], 'touchstart', 'point:2'), h.owner)
  h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
  h.motion.move(h.event([h.touch(100, 100), h.touch(200, 100)]), h.owner)
  assert.equal(h.state.gesture.nodeIndex, -1)
  h.motion.move(h.event([h.touch(50, 100), h.touch(250, 100)]), h.owner)
  h.motion.end(h.event([h.touch(50, 100)], 'touchend'), h.owner)
  assert.equal(h.state.gesture.second, null)
  h.motion.move(h.event([h.touch(80, 130)]), h.owner)
  h.motion.end(h.event([], 'touchcancel'), h.owner)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].args.node, null)
})

test('a tap stays clickable while movement suppresses the synthetic tap after release', () => {
  const h = motionFixture()
  const event = h.event([h.touch(100, 100)], 'touchstart', 'point:2')
  h.motion.nodeStart(event, h.owner)
  h.motion.start(event, h.owner)
  h.motion.move(h.event([h.touch(101, 100)]), h.owner)
  h.motion.end(h.event([], 'touchend'), h.owner)
  h.motion.tap(event, h.owner)
  assert.deepEqual(h.calls.map(call => call.name), ['onGraphNodeTap'])
  h.calls.length = 0
  h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
  h.motion.move(h.event([h.touch(120, 120)]), h.owner)
  h.motion.end(h.event([], 'touchcancel'), h.owner)
  h.motion.tap(event, h.owner)
  assert.deepEqual(h.calls.map(call => call.name), ['commitGraphMotion'])
  h.advance(281)
  h.motion.tap(event, h.owner)
  assert.equal(h.calls[1].name, 'onGraphNodeTap')
})

test('the core cannot be dragged and viewport measurement follows a scrolled page', () => {
  const h = motionFixture()
  h.rect.top = -240
  h.motion.nodeStart(h.event([h.touch(130, 120)], 'touchstart', 'core'), h.owner)
  h.motion.start(h.event([h.touch(130, 120)], 'touchstart'), h.owner)
  assert.equal(h.state.gesture.nodeIndex, -1)
  assert.equal(h.state.gesture.first.y, 120)
  h.motion.move(h.event([h.touch(160, 150)]), h.owner)
  h.motion.end(h.event([], 'touchcancel'), h.owner)
  assert.equal(h.calls[0].args.node, null)
})

test('inertia runs in the view layer and publishes a single settled camera', () => {
  const h = motionFixture()
  h.motion.start(h.event([h.touch(150, 150)], 'touchstart'), h.owner)
  h.advance(16)
  h.motion.move(h.event([h.touch(110, 115)]), h.owner)
  h.motion.end(h.event([], 'touchend'), h.owner)
  assert.equal(h.calls.length, 0)
  for (let index = 0; h.frames.length && index < 200; index++) h.tick()
  assert.equal(h.frames.length, 0)
  assert.equal(h.calls.length, 1)
  assert.equal(h.classes.has('graph-interacting'), false)
})

test('zoom and reset controls settle the current view before dispatch and cancel inertia', () => {
  for (const step of [1, -1, null]) {
    const h = motionFixture()
    h.motion.start(h.event([h.touch(150, 150)], 'touchstart'), h.owner)
    h.advance(16)
    h.motion.move(h.event([h.touch(110, 115)]), h.owner)
    h.motion.end(h.event([], 'touchend'), h.owner)
    h.tick()
    const camera = JSON.parse(JSON.stringify(h.state.camera))
    h.motion.control({ currentTarget: { dataset: step ? { step } : {} } }, h.owner)
    assert.deepEqual(h.calls.map(call => call.name), ['commitGraphMotion', step ? 'zoomGraph' : 'resetView'])
    assert.deepEqual(h.calls[0].args.camera, camera)
    for (let index = 0; h.frames.length && index < 20; index++) h.tick()
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.camera)), camera)
    assert.equal(h.calls.length, 2)
  }
})

test('hiding, resizing or changing scenes cancels old frames and releases the touch identity', () => {
  for (const hidden of [true, false]) {
    const h = motionFixture()
    h.motion.start(h.event([h.touch(120, 120)], 'touchstart'), h.owner)
    h.motion.move(h.event([h.touch(90, 90)]), h.owner)
    h.motion.end(h.event([], 'touchend'), h.owner)
    h.sync({ revision: 2, active: !hidden, camera: { x: 1, y: 2, scale: 0.8 } })
    for (let index = 0; h.frames.length && index < 20; index++) h.tick()
    assert.equal(h.calls.length, 0)
    assert.equal(h.state.gesture, null)
    assert.equal(h.state.nodeIndex, -1)
    assert.equal(h.classes.has('graph-interacting'), false)
    if (!hidden) assert.match(h.stage.style.transform, /translate3d\(1px,2px,0\)/)
  }
})

test('resetting a node drag clears higher-priority view styles using the new model geometry', () => {
  const h = motionFixture()
  h.motion.nodeStart(h.event([h.touch(100, 100)], 'touchstart', 'point:2'), h.owner)
  h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
  h.motion.move(h.event([h.touch(130, 130)]), h.owner)
  h.tick()
  h.sync({ revision: 2, nodes: [{ id: 'core', cx: 400, cy: 460, r: 40 }, { id: 'point:3', cx: 250, cy: 230, r: 24 }] })
  h.tick()
  const latest = h.styles.filter(row => row.name === 'node1').at(-1)
  assert.deepEqual(JSON.parse(JSON.stringify(latest.value)), { left: '226px', top: '206px' })
  assert.equal(h.calls.length, 0)
})

test('a delayed gesture acknowledgement cannot cancel the next gesture or rewind a newer commit', () => {
  let definition
  const originalPage = global.Page
  global.Page = page => { definition = page }
  const file = require.resolve('../subpackages/knowledge/knowledge-subject/index')
  delete require.cache[file]
  try { require(file) } finally { global.Page = originalPage }
  const h = motionFixture()
  const page = { ...definition, data: { ...definition.data, scene: { nodes: [], edges: [] } },
    _frame: h.rect, _camera: h.model.camera, _pageVisible: true,
    setData(patch) { Object.assign(this.data, patch); if (patch.graphMotionState) h.sync(patch.graphMotionState) } }
  page.setCamera(page._camera)
  h.tick()
  const drag = (x, y) => {
    h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
    h.motion.move(h.event([h.touch(x, y)]), h.owner)
    h.motion.end(h.event([], 'touchcancel'), h.owner)
  }
  drag(120, 120)
  h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
  h.motion.move(h.event([h.touch(110, 110)]), h.owner)
  const activeCamera = JSON.parse(JSON.stringify(h.state.camera))
  page.commitGraphMotion(h.calls[0].args)
  assert.ok(h.state.gesture, 'first acknowledgement must not clear the second gesture')
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.camera)), activeCamera)
  h.motion.move(h.event([h.touch(130, 130)]), h.owner)
  h.motion.end(h.event([], 'touchcancel'), h.owner)
  assert.equal(h.calls.length, 2)
  page.commitGraphMotion(h.calls[1].args)
  const settledCamera = { ...page._camera }
  assert.deepEqual(settledCamera, h.calls[1].args.camera)
  page.commitGraphMotion(h.calls[0].args)
  assert.deepEqual(page._camera, settledCamera, 'an old duplicate commit cannot rewind the latest one')
})

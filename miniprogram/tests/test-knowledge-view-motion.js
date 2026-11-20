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

test('theme and index controls flush the visible fling camera before changing the scene', () => {
  for (const action of ['chooseGroup', 'showOverview', 'setFilter', 'openThemeSheet', 'onGraphNodeTap', 'changeGraphPage', 'handleIndexRowTap', 'handleIndexActionTap', 'focusSearch', 'focusIndexSearch']) {
    const h = motionFixture()
    h.motion.start(h.event([h.touch(160, 150)], 'touchstart'), h.owner)
    h.advance(16)
    h.motion.move(h.event([h.touch(110, 115)]), h.owner)
    h.motion.end(h.event([], 'touchend'), h.owner)
    h.tick(); h.tick()
    const visibleCamera = JSON.parse(JSON.stringify(h.state.camera))
    assert.notDeepEqual(visibleCamera, h.model.camera, 'the visible camera is newer than its last JS acknowledgement')
    h.motion.action({ currentTarget: { dataset: { graphAction: action, key: 'chapter-2' } } }, h.owner)
    assert.deepEqual(h.calls.map(row => row.name), ['commitGraphMotion', action])
    assert.deepEqual(h.calls[0].args.camera, visibleCamera)
    assert.equal(h.classes.has('graph-interacting'), false)
    for (let index = 0; h.frames.length && index < 10; index++) h.tick()
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.camera)), visibleCamera, 'the cancelled fling cannot resume after navigation')
  }
})

test('an asynchronous scene update waits for the current WXS camera and cancels on hide', async () => {
  let definition
  const originalPage = global.Page
  global.Page = value => { definition = value }
  const file = require.resolve('../subpackages/knowledge/knowledge-subject/index')
  delete require.cache[file]
  try { require(file) } finally { global.Page = originalPage }
  const h = motionFixture()
  const page = { ...definition, data: { ...definition.data, graphMotionState: h.model, scene: { nodes: h.model.nodes.map(node => ({ ...node, label: node.id, kind: node.id === 'core' ? 'core' : 'point' })), edges: [] } },
    _frame: h.rect, _camera: { ...h.model.camera }, _graphMotionRevision: 1, _pageVisible: true,
    setData(patch) { Object.assign(this.data, patch) } }
  h.motion.start(h.event([h.touch(160, 150)], 'touchstart'), h.owner)
  h.advance(16)
  h.motion.move(h.event([h.touch(110, 115)]), h.owner)
  h.motion.end(h.event([], 'touchend'), h.owner)
  h.tick(); h.tick()
  const visible = JSON.parse(JSON.stringify(h.state.camera))
  let published = null
  const pending = page._afterGraphSettled(() => { published = { ...page._camera } })
  assert.equal(published, null, 'an API or debounce result waits instead of rebuilding from a stale camera')
  h.motion.flush(page.data.graphSettlementToken, 0, h.owner)
  assert.deepEqual(h.calls.map(call => call.name), ['commitGraphMotion', 'completeGraphSettlement'])
  h.calls.forEach(call => page[call.name](call.args))
  await pending
  assert.deepEqual(published, visible)
  const cancelled = page._afterGraphSettled(() => assert.fail('hidden page cannot apply its queued scene'))
  page._pageVisible = false
  page._cancelGraphSettlements()
  page.completeGraphSettlement({ token: page.data.graphSettlementToken })
  await cancelled
  assert.equal(page._pendingGraphSettlements.length, 0)
})

for (const phase of ['dragging', 'coasting', 'cancelled', 'released']) {
  test(`a scene acknowledgement preserves a newer ${phase} gesture across the bridge`, async () => {
    let definition
    const originalPage = global.Page
    global.Page = value => { definition = value }
    const file = require.resolve('../subpackages/knowledge/knowledge-subject/index')
    delete require.cache[file]
    try { require(file) } finally { global.Page = originalPage }
    const h = motionFixture()
    const page = {
      ...definition,
      data: { ...definition.data, graphMotionState: h.model, scene: {
        nodes: h.model.nodes.map(node => ({ ...node, label: node.id, kind: node.id === 'core' ? 'core' : 'point' })), edges: [],
      } },
      _frame: h.rect, _camera: { ...h.model.camera }, _graphMotionRevision: 1, _graphMotionFloor: 1, _pageVisible: true,
      setData(patch) {
        Object.assign(this.data, patch)
        if (patch.graphMotionState) h.sync(patch.graphMotionState)
      },
    }
    h.motion.start(h.event([h.touch(160, 150)], 'touchstart'), h.owner)
    h.motion.move(h.event([h.touch(110, 115)]), h.owner)
    const pending = page._afterGraphSettled(() => page.setData(page.cameraPayload(true, {}, page.data.scene, true, true)))
    h.motion.flush(page.data.graphSettlementToken, 0, h.owner)
    const messages = h.calls.splice(0)
    page.commitGraphMotion(messages[0].args)

    // The next touch begins before JS receives the settlement confirmation.
    h.motion.start(h.event([h.touch(100, 100)], 'touchstart'), h.owner)
    h.advance(16)
    h.motion.move(h.event([h.touch(130, 125)]), h.owner)
    if (phase === 'coasting') {
      h.motion.end(h.event([], 'touchend'), h.owner)
      h.tick()
    }
    if (phase === 'cancelled') h.motion.end(h.event([], 'touchcancel'), h.owner)
    if (phase === 'released') {
      h.advance(100)
      h.motion.end(h.event([], 'touchend'), h.owner)
      h.tick()
    }
    const latestCamera = JSON.parse(JSON.stringify(h.state.camera))
    const currentRun = h.state.run
    page.completeGraphSettlement(messages[1].args)
    await pending
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.camera)), latestCamera)
    assert.equal(h.state.run, currentRun, 'a scene acknowledgement cannot cancel a newer gesture or its inertia')
    assert.ok(h.stage.style.transform.startsWith(`translate3d(${latestCamera.x}px,${latestCamera.y}px`))

    if (phase === 'dragging') {
      assert.ok(h.state.gesture)
      h.motion.move(h.event([h.touch(145, 140)]), h.owner)
      h.motion.end(h.event([], 'touchcancel'), h.owner)
    } else if (phase === 'coasting') {
      for (let index = 0; h.frames.length && index < 200; index++) h.tick()
    }
    const result = h.calls.filter(row => row.name === 'commitGraphMotion').at(-1).args
    const drain = () => { while (h.calls.length) { const call = h.calls.shift(); page[call.name](call.args) } }
    drain()
    assert.deepEqual(page._camera, JSON.parse(JSON.stringify(h.state.camera)))
    assert.equal(page._graphGestureEpoch, result.gestureEpoch)

    const expectedZoom = zoomCamera(page._camera, 1.25, { x: h.rect.width / 2, y: h.rect.height / 2 }, h.rect)
    h.motion.control({ currentTarget: { dataset: { step: 1 } } }, h.owner)
    drain()
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.camera)), expectedZoom, 'the next zoom uses the newly acknowledged camera')
    page.commitGraphMotion({ ...result, gestureEpoch: result.gestureEpoch + 1 })
    assert.deepEqual(page._camera, expectedZoom, 'an explicit camera action closes the old scene compatibility interval')
  })
}

test('scene changes remap a newer node drag by id and stop it if its node disappears', () => {
  for (const removed of [false, true]) {
    const h = motionFixture()
    const initial = h.state.nodes[1]
    const x = h.state.camera.x + initial.cx * h.state.camera.scale
    const y = h.state.camera.y + initial.cy * h.state.camera.scale
    const start = h.event([h.touch(x, y)], 'touchstart', initial.id)
    h.motion.nodeStart(start, h.owner)
    h.motion.start(start, h.owner)
    h.motion.move(h.event([h.touch(x + 20, y + 10)]), h.owner)
    const moved = JSON.parse(JSON.stringify(h.state.changedNode))
    const camera = JSON.parse(JSON.stringify(h.state.camera))
    const nodes = removed ? [h.model.nodes[0]] : h.model.nodes.slice().reverse()
    h.sync({ revision: 2, gestureEpoch: 0, preserveMotion: true, nodes, edges: [] })
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.camera)), camera)
    if (removed) assert.equal(h.state.gesture, null)
    else {
      assert.equal(h.state.gesture.nodeIndex, 0)
      assert.deepEqual(JSON.parse(JSON.stringify(h.state.nodes[0])), moved)
      h.motion.move(h.event([h.touch(x + 40, y + 20)]), h.owner)
      h.motion.end(h.event([], 'touchcancel'), h.owner)
      assert.deepEqual(h.calls.at(-1).args.node, { id: initial.id, cx: 350, cy: 325 })
    }
  }
})

test('hiding or an acknowledged scene reset cancels old frames and releases the touch identity', () => {
  for (const hidden of [true, false]) {
    const h = motionFixture()
    h.motion.start(h.event([h.touch(120, 120)], 'touchstart'), h.owner)
    h.motion.move(h.event([h.touch(90, 90)]), h.owner)
    h.motion.end(h.event([], 'touchend'), h.owner)
    h.sync({ revision: 2, gestureEpoch: h.state.gestureEpoch, active: !hidden, camera: { x: 1, y: 2, scale: 0.8 } })
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

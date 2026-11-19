const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildScene, highlightScene, fitCamera, labelDisplay, DEFAULT_FORCES, POINTS_PER_PAGE } = require('../subpackages/knowledge/knowledge-subject/graph-layout')

const subject = { subject_name: '数据结构' }
function groupWithLeaves(count) {
  const root = { knowledge_point_id: 1, parentId: 0, name: '树', hasChildren: true, pathIds: [1], groupKey: 'tree' }
  const leaves = Array.from({ length: count }, (_, index) => ({
    knowledge_point_id: index + 2, parentId: 1, name: `知识点 ${index + 2}`,
    hasChildren: false, groupKey: 'tree', pathIds: [1, index + 2],
  }))
  return { key: 'tree', rootId: 1, rootNode: root, matchCount: count + 1, nodes: [root, ...leaves] }
}

test('force graph pagination keeps every leaf reachable, including the last sibling', () => {
  const group = groupWithLeaves(80)
  const ids = new Set()
  for (let page = 0; page < 10; page++) {
    const scene = buildScene([group], subject, { groupKey: group.key, focusNodeId: 1, page, selectedId: 81 })
    assert.equal(scene.pageCount, 10)
    scene.pointIds.forEach(id => ids.add(id))
    if (page === 9) assert.ok(scene.nodes.find(node => node.pointId === 81).selected)
    assert.ok(scene.nodes.length <= 72)
    assert.ok(scene.edges.every(edge => ['membership', 'hierarchy'].includes(edge.kind)), 'links represent actual hierarchy')
  }
  assert.equal(ids.size, 80)
})

test('large overview has a bounded scene and reachable overflow pages', () => {
  const groups = Array.from({ length: 600 }, (_, index) => {
    const node = { knowledge_point_id: index + 1, name: `独立点 ${index}`, parentId: 0, hasChildren: false }
    return { key: String(index), rootId: node.knowledge_point_id, rootNode: node, nodes: [node], matchCount: 1 }
  })
  const first = buildScene(groups, subject)
  assert.equal(first.nodes.length, POINTS_PER_PAGE + 1)
  assert.equal(first.pageCount, 75)
  const last = buildScene(groups, subject, { page: 74, selectedId: 600 })
  assert.equal(last.nodes.length, POINTS_PER_PAGE + 1)
  assert.ok(last.nodes.find(node => node.pointId === 600).selected)
})

test('selecting a point reuses coordinates, while force changes invalidate layout cache', () => {
  const group = groupWithLeaves(8)
  const layoutCache = {}
  const options = { groupKey: group.key, layoutCache }
  const initial = buildScene([group], subject, options)
  const cachedPositions = layoutCache.positions
  const selected = buildScene([group], subject, { ...options, selectedId: 2 })
  assert.equal(layoutCache.positions, cachedPositions, 'selection never reruns force simulation')
  assert.deepEqual(selected.nodes.map(node => [node.cx, node.cy]), initial.nodes.map(node => [node.cx, node.cy]))
  buildScene([group], subject, { ...options, forces: { ...DEFAULT_FORCES, repel: 20 } })
  assert.notEqual(layoutCache.positions, cachedPositions)
})

test('node size reflects real connections and selection highlights only neighbors and the ancestor path', () => {
  const scene = buildScene([groupWithLeaves(8)], subject, { selectedId: 2 })
  const root = scene.nodes.find(node => node.pointId === 1)
  const leaf = scene.nodes.find(node => node.pointId === 2)
  const other = scene.nodes.find(node => node.pointId === 3)
  assert.ok(root.r > leaf.r)
  assert.equal(leaf.selected, true)
  assert.equal(root.neighbor, true)
  assert.equal(other.dimmed, true)
  assert.equal(other.neighbor, false)
  assert.equal(scene.edges.filter(edge => edge.active).length, 2)
  highlightScene(scene, { selectedId: 3 })
  const frame = { width: 365, height: 343 }
  const labels = labelDisplay(fitCamera(frame), frame, scene.nodes).graphLabelVisibility
  assert.equal(leaf.selected, false)
  assert.equal(labels[other.id], true)
  highlightScene(scene)
  assert.ok(scene.nodes.every(node => !node.dimmed && !node.selected && !node.neighbor))
})

test('zoom reveals detail labels while preserving a readable screen size', () => {
  for (const width of [320, 390, 430]) {
    const frame = { width: width * 702 / 750, height: width * 660 / 750 }
    const camera = fitCamera(frame)
    const overview = labelDisplay(camera, frame)
    const detail = labelDisplay({ ...camera, scale: camera.scale * 2 }, frame)
    assert.equal(overview.graphLabelMode, 'overview')
    assert.equal(detail.graphLabelMode, 'detail')
    assert.ok(Math.abs(overview.graphLabelSize * camera.scale - 12) < 0.1, `${width}px overview labels`)
    assert.ok(Math.abs(detail.graphLabelSize * camera.scale * 2 - 12) < 0.1, `${width}px detail labels`)
  }
})

test('sparse chapter views show readable leaf names without requiring pinch zoom', () => {
  const scene = buildScene([groupWithLeaves(8)], subject, { groupKey: 'tree', focusNodeId: 1 })
  const frame = { width: 365, height: 343 }
  const shown = labelDisplay(fitCamera(frame), frame, scene.nodes).graphLabelVisibility
  assert.ok(scene.nodes.filter(node => node.kind === 'point' && shown[node.id]).length >= 4)
})

test('automatic labels avoid collisions, preserve selection priority, and stay stable while panning', () => {
  const frame = { width: 365, height: 343 }
  const camera = { ...fitCamera(frame), scale: 0.8 }
  const nodes = [
    { id: 'group:1', kind: 'group', label: '二叉树与遍历', cx: 300, cy: 300, r: 10 },
    { id: 'point:2', kind: 'point', label: '选中的知识点', cx: 300, cy: 300, r: 6, selected: true },
    { id: 'point:3', kind: 'point', label: '远处的知识点', cx: 600, cy: 300, r: 6 },
    { id: 'point:4', kind: 'point', label: '临近的知识点', cx: 380, cy: 300, r: 6 },
  ]
  const shown = labelDisplay(camera, frame, nodes).graphLabelVisibility
  assert.equal(shown['point:2'], true)
  assert.equal(shown['group:1'], undefined)
  assert.equal(shown['point:3'], true)
  assert.equal(shown['point:4'], undefined)
  assert.deepEqual(labelDisplay({ ...camera, x: camera.x + 40 }, frame, nodes).graphLabelVisibility, shown)
  assert.equal(labelDisplay({ ...camera, scale: 1.6 }, frame, nodes).graphLabelVisibility['point:4'], true, 'zooming in frees room for more names')
})

let pageDefinition
const originalPage = global.Page
global.Page = value => { pageDefinition = value }
require('../subpackages/knowledge/knowledge-subject/index')
global.Page = originalPage

test('label preference and camera gestures update presentation without recomputing scene positions', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const scene = buildScene([groupWithLeaves(8)], subject)
  const positions = scene.nodes.map(node => [node.cx, node.cy])
  const page = {
    ...pageDefinition, data: { ...pageDefinition.data, scene }, _frame: frame,
    _camera: fitCamera(frame), _pageVisible: true,
    setData(patch) { Object.assign(this.data, patch) },
  }
  const touch = (x, y) => ({ clientX: x, clientY: y })
  page.toggleGraphLabels()
  assert.equal(page.data.showAllGraphLabels, true)
  page.startGraphTouch({ touches: [touch(120, 100)] })
  page.moveGraphTouch({ touches: [touch(140, 120)] })
  assert.equal(page._gesture.moved, true)
  page.endGraphTouch({ touches: [], type: 'touchcancel' })
  page.startGraphTouch({ touches: [touch(100, 100), touch(200, 100)] })
  page.moveGraphTouch({ touches: [touch(50, 100), touch(250, 100)] })
  assert.equal(page.cameraPayload(false).graphLabelMode, 'detail')
  page.endGraphTouch({ touches: [], type: 'touchcancel' })
  assert.deepEqual(scene.nodes.map(node => [node.cx, node.cy]), positions)
  assert.ok(page._suppressTapUntil > Date.now())
  page.onHide()
})

test('index location on a large chapter retains the requested selection and detail', () => {
  const group = groupWithLeaves(80)
  const page = {
    ...pageDefinition, data: { subject, activeGroupKey: '' },
    _nodeById: new Map(group.nodes.map(node => [node.knowledge_point_id, node])),
    _filteredGroups: [group], _expandedNodeIds: new Set(),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    applyView() {
      const state = this._buildSceneState([group], this.data.activeGroupKey, this._focusNodeId)
      this._selectedId = state.selectedId
      this.data.scene = state.scene
      this.data.selectedPoint = this._nodeById.get(state.selectedId)
    },
  }
  page.locatePointById(81, { scrollToGraph: false })
  assert.equal(page._selectedId, 81)
  assert.equal(page.data.selectedPoint.knowledge_point_id, 81)
  assert.ok(page.data.scene.nodes.some(node => node.pointId === 81))
})

test('core remains fixed and hidden pages cancel pending force work', () => {
  const page = { ...pageDefinition, data: { subject }, _pageVisible: true, _forces: { ...DEFAULT_FORCES }, setData() {} }
  page.startGraphNodeTouch({ currentTarget: { dataset: { nodeId: 'core' } }, touches: [{}] })
  assert.equal(page._dragNodeId, '')
  page.changeForce({ currentTarget: { dataset: { key: 'repel' } }, detail: { value: 20 } })
  const timer = page._forceTimer
  assert.ok(timer)
  page.onHide()
  assert.equal(page._forceTimer, null)
  assert.equal(page._forceDirty, true)
  assert.equal(page._pageVisible, false)
})

test('panning only publishes the camera while zoom and node changes refresh labels', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const scene = buildScene([groupWithLeaves(8)], subject)
  const page = { ...pageDefinition, data: { scene }, _frame: frame, _camera: fitCamera(frame) }
  assert.ok(page.cameraPayload(false).graphLabelVisibility)
  page._camera = { ...page._camera, x: page._camera.x + 20 }
  assert.equal(page.cameraPayload(false).graphLabelVisibility, undefined)
  page._camera = { ...page._camera, scale: page._camera.scale * 2 }
  assert.ok(page.cameraPayload(false).graphLabelVisibility)
  page._cameraLabelCache = null
  assert.ok(page.cameraPayload(false).graphLabelVisibility)
})

test('drag events coalesce and release commits the final node position before teardown', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const page = {
    ...pageDefinition, data: {}, _frame: frame, _camera: fitCamera(frame), _pageVisible: true,
    _gesture: { moved: true, dragNodeId: 'point:2', touches: [{}] },
    commits: [], commitDraggedNode(point) { this.commits.push(point) },
    finishGraphInteraction() {},
  }
  page.moveDraggedNode({ x: 1, y: 2 })
  const timer = page._dragTimer
  page.moveDraggedNode({ x: 20, y: 30 })
  assert.equal(page._dragTimer, timer)
  assert.equal(page.commits.length, 0)
  page.endGraphTouch({ type: 'touchend', touches: [] })
  assert.deepEqual(page.commits, [{ x: 20, y: 30 }])
  assert.equal(page._dragTimer, null)
  assert.equal(page._gesture, null)
  assert.equal(page._pendingDragPoint, null)
})

test('hiding during node drag clears its identity before a new background gesture', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const page = {
    ...pageDefinition, data: { ...pageDefinition.data, graphInteracting: true },
    _frame: frame, _camera: fitCamera(frame), _pageVisible: true,
    _dragNodeId: 'point:2', _gesture: { dragNodeId: 'point:2' },
    setData(patch) { Object.assign(this.data, patch) },
  }
  page.moveDraggedNode({ x: 200, y: 200 })
  page.setCamera({ ...page._camera, x: 12 }, true, false)
  page.onHide()
  assert.equal(page._cameraTimer, null)
  assert.equal(page._inertiaTimer, null)
  assert.equal(page._dragTimer, null)
  assert.equal(page._gesture, null)
  assert.equal(page._dragNodeId, '')
  assert.equal(page.data.graphInteracting, false)
  page._pageVisible = true
  page.startGraphTouch({ touches: [{ clientX: 200, clientY: 200 }] })
  assert.equal(page._gesture.dragNodeId, '')
  page.endGraphTouch({ touches: [], type: 'touchcancel' })
})

test('a long label cannot obscure another node even when labels do not overlap each other', () => {
  const frame = { width: 365, height: 343 }
  const camera = { ...fitCamera(frame), scale: 0.8 }
  const nodes = [
    { id: 'group:1', kind: 'group', label: '线性表的顺序存储结构', cx: 300, cy: 300, r: 14 },
    { id: 'point:2', kind: 'point', label: '相邻节点', cx: 340, cy: 335, r: 7 },
  ]
  const shown = labelDisplay(camera, frame, nodes).graphLabelVisibility
  assert.equal(shown['group:1'], undefined)
  assert.equal(shown['point:2'], true)
})

test('resuming after a committed drag refreshes labels without another camera gesture', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const camera = { ...fitCamera(frame), scale: 0.8 }
  const nodes = [
    { id: 'group:1', kind: 'group', label: '线性表的顺序存储结构', cx: 300, cy: 300, r: 14 },
    { id: 'point:2', kind: 'point', label: '相邻节点', cx: 600, cy: 600, r: 7 },
  ]
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, scene: { nodes, edges: [] }, graphInteracting: true },
    _frame: frame, _camera: camera, _pageVisible: true, _loadedOnce: true, _readyForViewWork: true,
    _gesture: { dragNodeId: 'point:2' }, _manualPositions: {},
    _sceneNodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
    setData(patch) { Object.assign(this.data, patch) },
  }
  page.setCamera(camera)
  assert.equal(page.data.graphLabelVisibility['group:1'], true)
  page.commitDraggedNode({ x: 340 * camera.scale + camera.x, y: 335 * camera.scale + camera.y })
  assert.equal(page.data.graphLabelVisibility['group:1'], true, 'drag defers label recalculation')
  page.onHide()
  page.onShow()
  assert.equal(page.data.graphLabelVisibility['group:1'], undefined)
  assert.equal(page.data.graphLabelVisibility['point:2'], true)
  assert.equal(page.data.graphInteracting, false)
})

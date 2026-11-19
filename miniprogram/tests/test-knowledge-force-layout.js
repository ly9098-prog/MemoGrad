const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildScene, highlightScene, fitCamera, labelDisplay, DEFAULT_FORCES, POINTS_PER_PAGE, GROUPS_PER_PAGE } = require('../subpackages/knowledge/knowledge-subject/graph-layout')

const subject = { subject_name: '数据结构' }
function groupWithLeaves(count) {
  const root = { knowledge_point_id: 1, parentId: 0, name: '树', hasChildren: true, pathIds: [1], groupKey: 'tree' }
  const leaves = Array.from({ length: count }, (_, index) => ({
    knowledge_point_id: index + 2, parentId: 1, name: `知识点 ${index + 2}`,
    hasChildren: false, groupKey: 'tree', pathIds: [1, index + 2],
  }))
  return { key: 'tree', rootId: 1, rootNode: root, matchCount: count + 1, nodes: [root, ...leaves] }
}

function assertClearLabels(display, nodes, scale) {
  const boxes = []
  for (const node of nodes.filter(node => display.graphLabelVisibility[node.id])) {
    const { style } = display.graphLabelLayouts[node.id]
    const value = key => Number(style.match(new RegExp(`(?:^|;)${key}:([-\\d.]+)px;`))[1])
    const left = node.cx - node.r + value('left')
    const top = node.cy - node.r + value('top')
    const box = { left, right: left + value('width'), top, bottom: top + display.graphLabelSize * 1.4 }
    const intersects = other => box.left < other.right + 4 / scale - .001 && box.right > other.left - 4 / scale + .001 && box.top < other.bottom + 4 / scale - .001 && box.bottom > other.top - 4 / scale + .001
    for (const other of nodes.filter(other => other.id !== node.id)) {
      assert.equal(intersects({ left: other.cx - other.r, right: other.cx + other.r, top: other.cy - other.r, bottom: other.cy + other.r }), false, `${node.id} label obscures ${other.id}`)
    }
    assert.ok(boxes.every(other => !intersects(other)), `${node.id} label overlaps another label`)
    boxes.push(box)
  }
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
  assert.equal(first.nodes.length, GROUPS_PER_PAGE + 1)
  assert.equal(first.pageCount, 100)
  const last = buildScene(groups, subject, { page: 99, selectedId: 600 })
  assert.equal(last.nodes.length, GROUPS_PER_PAGE + 1)
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

test('node sizes preserve hierarchy and selection highlights only connected nodes', () => {
  const scene = buildScene([groupWithLeaves(8)], subject, { groupKey: 'tree', focusNodeId: 1, selectedId: 2 })
  const root = scene.nodes.find(node => node.pointId === 1)
  const leaf = scene.nodes.find(node => node.pointId === 2)
  const other = scene.nodes.find(node => node.pointId === 3)
  assert.ok(root.r > leaf.r)
  assert.equal(leaf.selected, true)
  assert.equal(root.neighbor, true)
  assert.equal(other.dimmed, true)
  assert.equal(other.neighbor, false)
  assert.equal(scene.edges.filter(edge => edge.active).length, 1)
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
  const display = labelDisplay(camera, frame, nodes)
  assert.equal(display.graphLabelVisibility['point:2'], true)
  assert.equal(display.graphLabelVisibility['point:3'], true)
  assertClearLabels(display, nodes, camera.scale)
  assert.deepEqual(labelDisplay({ ...camera, x: camera.x + 40 }, frame, nodes), display)
  assertClearLabels(labelDisplay({ ...camera, scale: 1.6 }, frame, nodes), nodes, 1.6)
})

let pageDefinition
const originalPage = global.Page
global.Page = value => { pageDefinition = value }
require('../subpackages/knowledge/knowledge-subject/index')
global.Page = originalPage

test('label preference and settled camera gestures preserve scene positions', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const scene = buildScene([groupWithLeaves(8)], subject)
  const positions = scene.nodes.map(node => [node.cx, node.cy])
  const page = { ...pageDefinition, data: { ...pageDefinition.data, scene }, _frame: frame,
    _camera: fitCamera(frame), _pageVisible: true, setData(patch) { Object.assign(this.data, patch) } }
  page.setGraphLabels({ currentTarget: { dataset: { mode: 'all' } } })
  assert.equal(page.data.showAllGraphLabels, true)
  page.setGraphLabels({ currentTarget: { dataset: { mode: 'all' } } })
  assert.equal(page.data.showAllGraphLabels, true, 'choosing the active option is idempotent')
  page.setGraphLabels({ currentTarget: { dataset: { mode: 'invalid' } } })
  assert.equal(page.data.showAllGraphLabels, true)
  page.setCamera(page._camera)
  page.commitGraphMotion({ revision: page.data.graphMotionState.revision, sequence: 1, camera: { ...page._camera, scale: page._camera.scale * 2 } })
  assert.equal(page.data.graphLabelMode, 'detail')
  assert.deepEqual(scene.nodes.map(node => [node.cx, node.cy]), positions)
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

test('hidden pages cancel pending force work', () => {
  const page = { ...pageDefinition, data: { subject }, _pageVisible: true, _forces: { ...DEFAULT_FORCES }, setData() {} }
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

test('one settled node update preserves manual placement and refreshes connected edges', () => {
  const group = groupWithLeaves(2), frame = { left: 0, top: 0, width: 365, height: 343 }
  const scene = buildScene([group], subject, { groupKey: 'tree', focusNodeId: 1 })
  const patches = []
  const page = { ...pageDefinition, data: { ...pageDefinition.data, scene }, _frame: frame,
    _camera: { ...fitCamera(frame), scale: 0.8 }, _pageVisible: true, _manualPositions: {},
    _sceneNodeIndex: new Map(scene.nodes.map((node, index) => [node.id, index])),
    _sceneEdgeLinks: new Map(), setData(patch) { patches.push(patch); Object.assign(this.data, patch) } }
  scene.edges.forEach((edge, index) => {
    for (const id of [edge.from, edge.to]) page._sceneEdgeLinks.set(id, [...(page._sceneEdgeLinks.get(id) || []), index])
  })
  page.setCamera(page._camera)
  patches.length = 0
  const before = scene.edges[0].style
  const node = scene.nodes.find(node => node.kind !== 'core')
  page.commitGraphMotion({ revision: page._graphMotionRevision, sequence: 1, camera: page._camera, node: { id: node.id, cx: 220, cy: 320 } })
  assert.equal(patches.length, 1)
  assert.deepEqual(page._manualPositions[node.id], { x: 220, y: 320 })
  assert.notEqual(scene.edges[0].style, before)
  assert.ok(page.data.graphLabelLayouts)
})

test('hidden pages reject stale view commits and resume with a fresh motion revision', () => {
  const frame = { left: 0, top: 0, width: 365, height: 343 }
  const page = { ...pageDefinition, data: { ...pageDefinition.data, scene: { nodes: [], edges: [] } },
    _frame: frame, _camera: fitCamera(frame), _pageVisible: true,
    _loadedOnce: true, _readyForViewWork: true, setData(patch) { Object.assign(this.data, patch) } }
  page.setCamera(page._camera)
  const revision = page._graphMotionRevision, before = { ...page._camera }
  page.onHide()
  assert.equal(page.data.graphMotionState.active, false)
  page.commitGraphMotion({ revision, sequence: 1, camera: { ...before, x: 12 } })
  assert.deepEqual(page._camera, before)
  page.onShow()
  assert.equal(page.data.graphMotionState.active, true)
  assert.ok(page._graphMotionRevision > revision)
  page.commitGraphMotion({ revision, sequence: 2, camera: { ...before, x: 20 } })
  assert.deepEqual(page._camera, before)
  page.onUnload()
  assert.equal(page.data.graphMotionState.active, false)
})

test('a long label cannot obscure another node even when labels do not overlap each other', () => {
  const frame = { width: 365, height: 343 }
  const camera = { ...fitCamera(frame), scale: 0.8 }
  const nodes = [
    { id: 'group:1', kind: 'group', label: '线性表的顺序存储结构', cx: 300, cy: 300, r: 14 },
    { id: 'point:2', kind: 'point', label: '相邻节点', cx: 340, cy: 335, r: 7 },
  ]
  const display = labelDisplay(camera, frame, nodes)
  assert.equal(display.graphLabelVisibility['group:1'], true, 'a clear alternative label position is preferred to hiding')
  assert.equal(display.graphLabelVisibility['point:2'], true)
  assertClearLabels(display, nodes, camera.scale)
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
    data: { ...pageDefinition.data, scene: { nodes, edges: [] } },
    _frame: frame, _camera: camera, _pageVisible: true, _loadedOnce: true, _readyForViewWork: true,
    _manualPositions: {},
    _sceneNodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
    setData(patch) { Object.assign(this.data, patch) },
  }
  page.setCamera(camera)
  assert.equal(page.data.graphLabelVisibility['group:1'], true)
  const initialLabelStyle = page.data.graphLabelLayouts['group:1'].style
  page.commitGraphMotion({ revision: page._graphMotionRevision, sequence: 1, camera, node: { id: 'point:2', cx: 340, cy: 335 } })
  assert.notEqual(page.data.graphLabelLayouts['group:1'].style, initialLabelStyle, 'settled drag refreshes labels immediately')
  page.onHide()
  page.onShow()
  assert.notEqual(page.data.graphLabelLayouts['group:1'].style, initialLabelStyle)
  assertClearLabels(page.data, nodes, camera.scale)
  assert.equal(page.data.graphLabelVisibility['point:2'], true)
  assert.equal(page.data.graphMotionState.active, true)
})

test('overview and focused scenes disclose one level while all descendants remain reachable', () => {
  const branch = { knowledge_point_id: 2, parentId: 1, name: '二级章节', hasChildren: true, pathIds: [1, 2], groupKey: 'tree' }
  const leaves = Array.from({ length: 25 }, (_, index) => ({ knowledge_point_id: index + 3, parentId: 2, name: `三级考点${index}`, hasChildren: false, pathIds: [1, 2, index + 3], groupKey: 'tree' }))
  const root = { knowledge_point_id: 1, name: '章节', hasChildren: true, pathIds: [1], groupKey: 'tree' }
  const group = { key: 'tree', rootId: 1, rootNode: root, nodes: [root, branch, ...leaves], matchCount: 27 }
  assert.deepEqual(buildScene([group], subject).nodes.map(node => node.pointId), [0, 1])
  const chapter = buildScene([group], subject, { groupKey: 'tree', focusNodeId: 1 })
  assert.deepEqual(chapter.nodes.map(node => node.pointId), [1, 2])
  const reachable = new Set()
  for (let page = 0; page < 4; page++) {
    const scene = buildScene([group], subject, { groupKey: 'tree', focusNodeId: 2, page })
    assert.ok(scene.nodes.length <= POINTS_PER_PAGE + 1)
    assert.equal(scene.parentFocusId, 1)
    scene.pointIds.forEach(id => reachable.add(id))
  }
  assert.deepEqual([...reachable], leaves.map(node => node.knowledge_point_id))
})

test('direct and search index navigation preserve selection across chapter page boundaries', () => {
  const groups = Array.from({ length: 14 }, (_, index) => {
    const node = { knowledge_point_id: index + 1, name: `独立考点${index + 1}`, parentId: 0, hasChildren: false, groupKey: String(index), pathIds: [index + 1] }
    return { key: node.groupKey, rootId: node.knowledge_point_id, rootNode: node, nodes: [node], matchCount: 1 }
  })
  for (const route of ['direct', 'search']) {
    for (const index of [5, 6, 11, 12]) {
      const point = groups[index].rootNode
      const page = {
        ...pageDefinition, data: { ...pageDefinition.data, subject },
        _groups: groups, _filteredGroups: groups, _expandedNodeIds: new Set(),
        _nodeById: new Map(groups.map(group => [group.rootId, group.rootNode])),
        _layoutCache: {}, _manualPositions: {},
        setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
        applyView() {
          const state = this._buildSceneState(groups, this.data.activeGroupKey, this._focusNodeId)
          this.data.scene = state.scene
          this._selectedId = state.selectedId
        },
      }
      if (route === 'direct') page.locatePointById(point.knowledge_point_id, { scrollToGraph: false })
      else {
        page._selectedId = point.knowledge_point_id
        const focus = page._resolveIndexNavigationFocus(point, point.knowledge_point_id, groups[index], {}, '')
        page.setData(focus)
        page.applyView()
      }
      assert.equal(page.data.scene.page, Math.floor(index / GROUPS_PER_PAGE), `${route} point ${index + 1}`)
      assert.equal(page._selectedId, point.knowledge_point_id)
      assert.ok(page.data.scene.nodes.some(node => node.pointId === point.knowledge_point_id && node.selected))
    }
  }
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const {
  WORLD,
  buildScene,
  fitCamera,
  cameraLimits,
  clampCamera,
  zoomCamera,
  cameraStyle,
} = require('../subpackages/knowledge/knowledge-subject/graph-layout')

const root = path.resolve(__dirname, '..')

function makeGroup(key, name, childCount, idBase = 1) {
  const rootNode = {
    knowledge_point_id: idBase,
    name,
    parentId: 0,
    depth: 1,
    tone: 'stable',
    status: 'good',
    hasChildren: true,
    matchCount: childCount,
  }
  const nodes = [rootNode]
  for (let index = 0; index < childCount; index += 1) {
    nodes.push({
      knowledge_point_id: idBase + index + 1,
      name: `${name}知识点${index + 1}`,
      parentId: idBase,
      depth: 2,
      tone: index % 3 === 0 ? 'weak' : 'stable',
      status: index % 3 === 0 ? 'weak' : 'good',
      hasChildren: false,
      matchCount: 1,
    })
  }
  return { key, name, rootId: idBase, rootNode, nodes, matchCount: childCount }
}

function assertFiniteScene(scene) {
  const ids = new Set(scene.nodes.map(node => node.id))
  assert.equal(ids.size, scene.nodes.length, 'node ids must stay unique')
  for (const node of scene.nodes) {
    assert.ok(Number.isFinite(node.cx) && Number.isFinite(node.cy), `${node.id} coordinates must be finite`)
    assert.ok(!node.style.includes('NaN'), `${node.id} style must not contain NaN`)
  }
  for (const edge of scene.edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to), `${edge.id} must reference scene nodes`)
    assert.ok(!edge.style.includes('NaN'), `${edge.id} style must not contain NaN`)
  }
}

test('overview scene stays bounded with finite node and edge geometry', () => {
  const groups = [
    makeGroup('data-structure', '数据结构', 24, 1),
    makeGroup('computer-organization', '计算机组成原理', 24, 1000),
    makeGroup('operating-system', '操作系统', 24, 2000),
    makeGroup('computer-network', '计算机网络', 24, 3000),
  ]
  const scene = buildScene(groups, { subject_name: '408' }, { activeGroupKey: '' })

  assert.equal(scene.focused, false)
  assert.ok(scene.nodes.length <= 72, 'overview scene must remain within the focus-node cap')
  assert.ok(scene.edges.length > groups.length)
  assertFiniteScene(scene)
})

test('focused scene caps large branches and keeps the selected path renderable', () => {
  const group = makeGroup('operating-system', '操作系统', 140)
  const scene = buildScene([group], { subject_name: '408' }, {
    groupKey: group.key,
    activeGroupKey: group.key,
    focusNodeId: 1,
    selectedId: 2,
  })

  assert.equal(scene.focused, true)
  assert.ok(scene.nodes.length <= 72)
  assert.ok(scene.nodes.some(node => node.selected))
  assert.ok(scene.pointIds.length <= 71)
  assertFiniteScene(scene)
})

test('camera helpers keep scale, translation and style finite at viewport limits', () => {
  const frame = { width: 375, height: 660 }
  const fit = fitCamera(frame)
  const limits = cameraLimits(frame)

  assert.ok(fit.scale > 0 && Number.isFinite(fit.x) && Number.isFinite(fit.y))
  assert.ok(limits.min > 0 && limits.max >= limits.min)

  const clamped = clampCamera({ x: 99999, y: -99999, scale: 999 }, frame)
  assert.ok(clamped.scale >= limits.min && clamped.scale <= limits.max)
  assert.ok(Number.isFinite(clamped.x) && Number.isFinite(clamped.y))

  const zoomed = zoomCamera(fit, 20, { x: 0, y: 0 }, frame)
  assert.ok(zoomed.scale >= limits.min && zoomed.scale <= limits.max)
  assert.match(cameraStyle(zoomed), /^transform:translate3d\(-?\d+\.?\d*px,-?\d+\.?\d*px,0\) scale\([^)]+\);$/)
  assert.ok(WORLD.width > 0 && WORLD.height > 0)
})

test('knowledge graph presentation keeps motion fallbacks and accessible controls', () => {
  const pageRoot = path.join(root, 'subpackages', 'knowledge', 'knowledge-subject')
  const markup = fs.readFileSync(path.join(pageRoot, 'index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(pageRoot, 'index.wxss'), 'utf8')
  const homeMarkup = fs.readFileSync(path.join(root, 'pages', 'home', 'home.wxml'), 'utf8')
  const homeStyles = fs.readFileSync(path.join(root, 'pages', 'home', 'home.wxss'), 'utf8')

  assert.match(markup, /scene-animating/)
  assert.match(markup, /point-card-reveal-\{\{indexDetailRevealPhase/)
  assert.match(markup, /bindchanging="changeForce" bindchange="changeForce" aria-label="\{\{item\.label\}\}"/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\{\.page-reveal[\s\S]*?\.atlas-stage,\.atlas-node/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\.scene-animating \.atlas-node/)
  assert.match(homeMarkup, /brand-mark-image[^>]*aria-hidden="true"/)
  assert.doesNotMatch(homeStyles, /#76968B/)
  assert.doesNotMatch(styles, /#76968B/)
})

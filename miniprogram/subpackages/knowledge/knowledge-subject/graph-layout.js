'use strict'

// A quiet, deterministic force graph. Coordinates live in world space; the camera
// is the only layer that changes when the viewport is resized or zoomed.
const WORLD = { width: 800, height: 920 }
const POINTS_PER_PAGE = 8
const DEFAULT_FORCES = { center: 0.18, repel: 18, link: 0.8, distance: 270 }
const GROUPS_PER_PAGE = 6

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const directChildren = (group, id) => (Array.isArray(group && group.nodes) ? group.nodes : []).filter(item => Number(item.parentId) === Number(id))
const seeded = (id) => {
  const value = Math.sin((Number(id) || 1) * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function dotStyle(node) {
  const radius = Number(node.r) || 5
  return `left:${(node.cx - radius).toFixed(2)}px;top:${(node.cy - radius).toFixed(2)}px;width:${(radius * 2).toFixed(2)}px;height:${(radius * 2).toFixed(2)}px;`
}

function edgeStyle(from, to) {
  if (!from || !to) return ''
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  const length = Math.sqrt(dx * dx + dy * dy) || 1
  const start = Math.min(length * 0.35, Number(from.r) || 0)
  const end = Math.min(length * 0.35, Number(to.r) || 0)
  const x = from.cx + dx * start / length
  const y = from.cy + dy * start / length
  const width = Math.max(0, length - start - end)
  return `left:${x.toFixed(2)}px;top:${y.toFixed(2)}px;width:${width.toFixed(2)}px;transform:rotate(${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2)}deg);`
}

function makeNode(id, kind, item, groupKey, extra) {
  const node = {
    id,
    kind,
    label: String((item && item.name) || '知识图谱'),
    cx: 400,
    cy: 460,
    r: kind === 'core' ? 22 : (kind === 'group' ? 11 : 6),
    pointId: Number(item && item.knowledge_point_id) || 0,
    groupKey: String(groupKey || ''),
    tone: (item && item.tone) || 'unseen',
    expandable: Boolean(item && item.hasChildren),
    selected: false,
    neighbor: false,
    pathActive: false,
    dimmed: false,
    caption: item && item.hasChildren ? `${Number(item.matchCount) || 0} 个知识点` : '',
    iconSrc: String((item && item.icon) || ''),
  }
  Object.assign(node, extra || {})
  node.style = dotStyle(node)
  return node
}

function makeEdge(from, to, kind) {
  return {
    id: `${from.id}->${to.id}`,
    from: from.id,
    to: to.id,
    kind: kind || 'hierarchy',
    active: false,
    dimmed: false,
    style: '',
    distance: 80,
    strength: 1,
  }
}

function simulate(nodes, links, forces, manualPositions, focused, cache) {
  if (!nodes.length) return
  const cacheKey = JSON.stringify([nodes.map(node => [node.id, node.cx, node.cy]), links.map(link => [link.from, link.to]), forces, manualPositions])
  if (cache && cache.key === cacheKey) {
    nodes.forEach(node => Object.assign(node, cache.positions[node.id]))
    return
  }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const center = { x: WORLD.width / 2, y: WORLD.height / 2 }
  const ticks = 110
  const velocity = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]))
  nodes.forEach((node) => {
    const manual = manualPositions && manualPositions[node.id]
    if (manual && Number.isFinite(manual.x) && Number.isFinite(manual.y)) {
      node.cx = clamp(manual.x, 24, WORLD.width - 24)
      node.cy = clamp(manual.y, 24, WORLD.height - 24)
      node.fixed = true
    } else {
      node.fixed = node.kind === 'core'
    }
  })
  for (let tick = 0; tick < ticks; tick += 1) {
    const fx = new Map(nodes.map(node => [node.id, 0]))
    const fy = new Map(nodes.map(node => [node.id, 0]))
    nodes.forEach((node) => {
      if (node.fixed) return
      const gravity = forces.center * (focused ? 0.0015 : 0.0011)
      fx.set(node.id, (center.x - node.cx) * gravity)
      fy.set(node.id, (center.y - node.cy) * gravity)
    })
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]
        let dx = a.cx - b.cx
        let dy = a.cy - b.cy
        let d2 = dx * dx + dy * dy
        if (d2 > 120000) continue
        if (d2 < 0.01) { dx = seeded(i * 97 + j) - 0.5; dy = seeded(j * 53 + i) - 0.5; d2 = dx * dx + dy * dy + 0.01 }
        const distance = Math.sqrt(d2)
        const force = Math.min(2.4, forces.repel * 72 / d2)
        const px = dx / distance * force
        const py = dy / distance * force
        if (!a.fixed) { fx.set(a.id, fx.get(a.id) + px); fy.set(a.id, fy.get(a.id) + py) }
        if (!b.fixed) { fx.set(b.id, fx.get(b.id) - px); fy.set(b.id, fy.get(b.id) - py) }
        const clearance = a.r + b.r + 80
        if (distance < clearance) {
          const push = (clearance - distance) * 0.12
          const cx = dx / distance * push
          const cy = dy / distance * push
          if (!a.fixed) { fx.set(a.id, fx.get(a.id) + cx); fy.set(a.id, fy.get(a.id) + cy) }
          if (!b.fixed) { fx.set(b.id, fx.get(b.id) - cx); fy.set(b.id, fy.get(b.id) - cy) }
        }
      }
    }
    links.forEach((link) => {
      const a = byId.get(link.from)
      const b = byId.get(link.to)
      if (!a || !b) return
      const dx = b.cx - a.cx
      const dy = b.cy - a.cy
      const distance = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (distance - link.distance) * forces.link * 0.006 * link.strength
      const px = dx / distance * force
      const py = dy / distance * force
      if (!a.fixed) { fx.set(a.id, fx.get(a.id) + px); fy.set(a.id, fy.get(a.id) + py) }
      if (!b.fixed) { fx.set(b.id, fx.get(b.id) - px); fy.set(b.id, fy.get(b.id) - py) }
    })
    nodes.forEach((node) => {
      if (node.fixed) return
      const speed = velocity.get(node.id)
      speed.x = clamp((speed.x + fx.get(node.id)) * 0.84, -11, 11)
      speed.y = clamp((speed.y + fy.get(node.id)) * 0.84, -11, 11)
      node.cx = clamp(node.cx + speed.x, 26, WORLD.width - 26)
      node.cy = clamp(node.cy + speed.y, 26, WORLD.height - 26)
    })
  }
  if (cache) {
    cache.key = cacheKey
    cache.positions = Object.fromEntries(nodes.map(node => [node.id, { cx: node.cx, cy: node.cy }]))
  }
}

function buildOverview(groups, subject, forces, requestedPage) {
  const nodes = []
  const edges = []
  const pointIds = []
  const core = makeNode('core', 'core', { name: (subject && subject.subject_name) || '知识图谱', tone: 'stable' }, '')
  nodes.push(core)
  const allGroups = (Array.isArray(groups) ? groups : []).filter(group => group && group.rootNode)
  const pageCount = Math.max(1, Math.ceil(allGroups.length / GROUPS_PER_PAGE))
  const page = clamp(Math.floor(Number(requestedPage) || 0), 0, pageCount - 1)
  const list = allGroups.slice(page * GROUPS_PER_PAGE, (page + 1) * GROUPS_PER_PAGE)
  list.forEach((group, groupIndex) => {
    const root = group.rootNode
    const rootId = Number(root.knowledge_point_id)
    const angle = -Math.PI / 2 + groupIndex * Math.PI * 2 / Math.max(1, list.length)
    const rootNode = makeNode(`${root.hasChildren ? 'group' : 'point'}:${rootId}`, root.hasChildren ? 'group' : 'point', root, group.key, {
      cx: 400 + Math.cos(angle) * 250,
      cy: 460 + Math.sin(angle) * 250,
      r: root.hasChildren ? 12 : 6,
      chapterRoot: true,
    })
    nodes.push(rootNode)
    if (!root.hasChildren) pointIds.push(rootId)
    const coreEdge = makeEdge(core, rootNode, 'membership')
    coreEdge.distance = forces.distance
    coreEdge.strength = 0.85
    edges.push(coreEdge)

  })
  return { nodes, edges, pointIds, core, focusNode: null, directChildCount: 0, page, pageCount, total: allGroups.length }

}

function buildFocused(group, focusNode, forces, requestedPage) {
  const nodes = []
  const edges = []
  const pointIds = []
  const focusId = Number(focusNode.knowledge_point_id)
  const core = makeNode('core', 'core', focusNode, group.key, { tone: focusNode.tone })
  nodes.push(core)
  const firstLevel = directChildren(group, focusId)
  const pageCount = Math.max(1, Math.ceil(firstLevel.length / POINTS_PER_PAGE))
  const page = clamp(Math.floor(Number(requestedPage) || 0), 0, pageCount - 1)
  const visibleChildren = firstLevel.slice(page * POINTS_PER_PAGE, (page + 1) * POINTS_PER_PAGE)
  // A phone shows one real hierarchy level at a time. Branch nodes remain
  // expandable, so every descendant is reachable without packing it into this scene.
  visibleChildren.forEach((item, index) => {
    const id = Number(item.knowledge_point_id)
    const phase = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, visibleChildren.length)
    const node = makeNode(`${item.hasChildren ? 'group' : 'point'}:${id}`, item.hasChildren ? 'group' : 'point', item, group.key, {
      cx: core.cx + Math.cos(phase) * 265,
      cy: core.cy + Math.sin(phase) * 265,
    })
    nodes.push(node)
    if (!item.hasChildren) pointIds.push(id)
    const edge = makeEdge(core, node, 'hierarchy')
    edge.distance = Math.max(200, forces.distance)
    edges.push(edge)
  })
  return { nodes, edges, pointIds, core, focusNode, directChildCount: firstLevel.length, page, pageCount, total: firstLevel.length }
}

function resolveFocusNode(groups, options) {
  const groupKey = String((options && options.groupKey) || '')
  const group = (Array.isArray(groups) ? groups : []).find(item => String(item.key) === groupKey)
  if (!group) return null
  const focusNodeId = Number(options && options.focusNodeId)
  if (focusNodeId) return group.nodes.find(item => Number(item.knowledge_point_id) === focusNodeId) || null
  return group.rootNode && group.rootNode.hasChildren ? group.rootNode : null
}

function breadcrumbItems(group, focusNode, subject) {
  if (!group || !focusNode) return []
  const subjectName = String((subject && subject.subject_name) || group.label || '全科图谱')
  const items = [{ id: 'root', label: subjectName, kind: 'root', focusNodeId: 0 }]
  const pathIds = Array.isArray(focusNode.pathIds) ? focusNode.pathIds : []
  pathIds.forEach((id) => {
    if (Number(id) === Number(focusNode.knowledge_point_id)) return
    const item = group.nodes.find(node => Number(node.knowledge_point_id) === Number(id))
    if (item) items.push({ id: `node:${id}`, label: item.name, kind: 'node', focusNodeId: Number(id) })
  })
  items.push({ id: 'current', label: focusNode.name, kind: 'current', focusNodeId: Number(focusNode.knowledge_point_id) })
  return items
}

function buildScene(groups, subject, options = {}) {
  const source = Array.isArray(groups) ? groups : []
  if (!source.length) {
    return {
      nodes: [], edges: [], pointIds: [], page: 0, pageCount: 1, total: 0, matchTotal: 0,
      rangeText: '0 个主题', focused: false, focusNodeId: 0, parentFocusId: 0, groupKey: '',
      title: '知识图谱', hint: '', countText: '0 个知识点', scopeText: '全科知识图谱', breadcrumbs: [],
    }
  }
  const focusNode = resolveFocusNode(source, options)
  const focusedGroup = focusNode ? source.find(group => String(group.key) === String(options.groupKey)) : null
  const forces = Object.assign({}, DEFAULT_FORCES, (options && options.forces) || {})
  const graph = focusNode && focusedGroup
    ? buildFocused(focusedGroup, focusNode, forces, options.page)
    : buildOverview(source, subject, forces, options.page)
  graph.nodes.forEach(node => {
    node.r = node.kind === 'core' ? 40 : node.chapterRoot ? 30 : 22
  })
  simulate(graph.nodes, graph.edges, forces, options.manualPositions || {}, Boolean(focusNode), options.layoutCache)
  highlightScene(graph, options)
  const matchTotal = focusNode
    ? Number(focusNode.matchCount) || graph.pointIds.length
    : source.reduce((sum, group) => sum + (Number(group.matchCount) || 0), 0)
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    pointIds: graph.pointIds,
    page: graph.page,
    pageCount: graph.pageCount,
    total: graph.total,
    matchTotal,
    rangeText: `${graph.page + 1} / ${graph.pageCount}`,
    focused: Boolean(focusNode),
    focusNodeId: focusNode ? Number(focusNode.knowledge_point_id) : 0,
    parentFocusId: focusNode ? Number(focusNode.parentId) || 0 : 0,
    groupKey: focusNode ? String(focusedGroup.key) : '',
    title: focusNode ? focusNode.name : '知识图谱',
    hint: '拖动节点整理布局 · 双指缩放',
    countText: focusNode ? `${graph.directChildCount} 个直接子节点` : `${source.length} 个主题 · ${matchTotal} 个知识点`,
    scopeText: focusNode ? `${focusNode.name} · 局部图谱` : '全科知识图谱',
    breadcrumbs: focusNode ? breadcrumbItems(focusedGroup, focusNode, subject) : [],
  }
}

function highlightScene(graph, options = {}) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const selectedId = Number(options && options.selectedId) || 0
  const selectedNode = graph.nodes.find(node => node.kind === 'point' && node.pointId === selectedId)
  const highlight = new Set()
  const neighbors = new Set()
  graph.edges.forEach(edge => { edge.active = false })
  if (selectedNode) {
    highlight.add(selectedNode.id)
    graph.edges.forEach(edge => {
      if (edge.from !== selectedNode.id && edge.to !== selectedNode.id) return
      const neighborId = edge.from === selectedNode.id ? edge.to : edge.from
      neighbors.add(neighborId)
      highlight.add(neighborId)
      edge.active = true
    })
    let ancestor = selectedNode.id
    const visited = new Set()
    while (!visited.has(ancestor)) {
      visited.add(ancestor)
      const edge = graph.edges.find(item => item.to === ancestor)
      if (!edge) break
      highlight.add(edge.from)
      edge.active = true
      ancestor = edge.from
    }
  } else if (options && options.activeGroupKey && !graph.focused) {
    graph.nodes.forEach((node) => {
      if (node.kind === 'core' || node.groupKey === String(options.activeGroupKey)) highlight.add(node.id)
    })
    graph.edges.forEach((edge) => { if (highlight.has(edge.from) && highlight.has(edge.to)) edge.active = true })
  }
  const hasHighlight = highlight.size > 0
  graph.nodes.forEach((node) => {
    node.selected = Boolean(selectedNode && node.id === selectedNode.id)
    node.neighbor = neighbors.has(node.id)
    node.pathActive = highlight.has(node.id)
    node.dimmed = hasHighlight && !highlight.has(node.id)
    node.style = dotStyle(node)
  })
  graph.edges.forEach((edge) => {
    edge.dimmed = hasHighlight && !edge.active
    edge.style = edgeStyle(byId.get(edge.from), byId.get(edge.to))
  })
  return graph
}

function fitCamera(frame) {
  const scale = Math.min(frame.width / WORLD.width, frame.height / WORLD.height) * 0.965
  return { scale, x: (frame.width - WORLD.width * scale) / 2, y: (frame.height - WORLD.height * scale) / 2 }
}

function cameraLimits(frame) {
  const fit = fitCamera(frame).scale
  return { min: fit, max: Math.max(1.6, fit * 2.1) }
}

function clampCamera(camera, frame) {
  const limits = cameraLimits(frame)
  const next = { ...camera, scale: clamp(camera.scale, limits.min, limits.max) }
  const width = WORLD.width * next.scale
  const height = WORLD.height * next.scale
  const minX = Math.min(28, frame.width - width - 28)
  const maxX = Math.max(28, frame.width - width - 28)
  const minY = Math.min(28, frame.height - height - 28)
  const maxY = Math.max(28, frame.height - height - 28)
  next.x = clamp(next.x, minX, maxX)
  next.y = clamp(next.y, minY, maxY)
  return next
}

function zoomCamera(camera, factor, anchor, frame) {
  const limits = cameraLimits(frame)
  const nextScale = clamp(camera.scale * factor, limits.min, limits.max)
  const ratio = nextScale / camera.scale
  return clampCamera({
    scale: nextScale,
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
  }, frame)
}

function cameraStyle(camera) {
  // The stage scales in world space; keep its node targets finger-sized on screen.
  return `transform:translate3d(${camera.x}px,${camera.y}px,0) scale(${camera.scale});--graph-hit-size:${44 / camera.scale}px;`
}

function visibleLabels(nodes, fontSize, scale) {
  const visibility = {}
  const layouts = {}
  const occupied = new Map()
  const obstacles = new Map()
  const cellSize = Math.max(48, fontSize * 6)
  const cells = (box) => {
    const keys = []
    for (let x = Math.floor(box.left / cellSize); x <= Math.floor(box.right / cellSize); x += 1) {
      for (let y = Math.floor(box.top / cellSize); y <= Math.floor(box.bottom / cellSize); y += 1) keys.push(`${x}:${y}`)
    }
    return keys
  }
  nodes.forEach(node => {
    const box = { left: node.cx - node.r, right: node.cx + node.r, top: node.cy - node.r, bottom: node.cy + node.r, id: node.id }
    cells(box).forEach(key => {
      const entries = obstacles.get(key) || []
      entries.push(box)
      obstacles.set(key, entries)
    })
  })
  const priority = node => node.selected ? 0 : node.kind === 'core' ? 1 : node.neighbor ? 2 : node.kind === 'group' ? 3 : 4
  const candidates = [...nodes].sort((a, b) => priority(a) - priority(b) || Number(a.dimmed) - Number(b.dimmed) || a.id.localeCompare(b.id))
  const gap = 4 / scale
  const units = text => Array.from(text).reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1 : 0.58), 0)
  const shorten = (text, maxWidth) => {
    if (units(text) * fontSize <= maxWidth) return text
    let result = ''
    for (const char of Array.from(text)) {
      if (units(result + char + '…') * fontSize > maxWidth) break
      result += char
    }
    return result + '…'
  }
  candidates.forEach(node => {
    const height = fontSize * 1.4
    const variants = [...new Set([node.selected ? 340 : 280, 220, 160].map(width => shorten(node.label, width)))]
    for (const text of variants) {
      const width = units(text) * fontSize
      const positions = [
        { left: node.cx - width / 2, top: node.cy + node.r + 10 },
        { left: node.cx - width / 2, top: node.cy - node.r - 10 - height },
        { left: node.cx + node.r + 10, top: node.cy - height / 2 },
        { left: node.cx - node.r - 10 - width, top: node.cy - height / 2 },
      ]
      for (const position of positions) {
        const box = { ...position, right: position.left + width, bottom: position.top + height }
        if (box.left < 8 || box.right > WORLD.width - 8 || box.top < 8 || box.bottom > WORLD.height - 8) continue
        const nearby = cells({ left: box.left - gap, right: box.right + gap, top: box.top - gap, bottom: box.bottom + gap })
        const intersects = other => box.left < other.right + gap && box.right > other.left - gap && box.top < other.bottom + gap && box.bottom > other.top - gap
        if (nearby.some(key => (obstacles.get(key) || []).some(other => other.id !== node.id && intersects(other)))) continue
        if (nearby.some(key => (occupied.get(key) || []).some(intersects))) continue
        visibility[node.id] = true
        // Explicit world-space offsets keep rendered labels and collision boxes aligned.
        layouts[node.id] = { text, style: `left:${box.left - (node.cx - node.r)}px;top:${box.top - (node.cy - node.r)}px;width:${width}px;max-width:none;bottom:auto;transform:none;` }
        cells(box).forEach(key => {
          const entries = occupied.get(key) || []
          entries.push(box)
          occupied.set(key, entries)
        })
        return
      }
    }
  })
  return { graphLabelVisibility: visibility, graphLabelLayouts: layouts }
}

function labelDisplay(camera, frame, nodes) {
  const ratio = camera.scale / fitCamera(frame).scale
  const graphLabelMode = ratio >= 1.6 ? 'detail' : 'overview'
  const graphLabelSize = Math.round(clamp(12 / camera.scale, 8, 48) * 10) / 10
  return {
    graphLabelMode,
    graphLabelSize,
    ...(nodes ? visibleLabels(nodes, graphLabelSize, camera.scale) : {}),
  }
}

module.exports = { WORLD, POINTS_PER_PAGE, GROUPS_PER_PAGE, DEFAULT_FORCES, buildScene, highlightScene, dotStyle, edgeStyle, fitCamera, cameraLimits, clampCamera, zoomCamera, cameraStyle, labelDisplay }

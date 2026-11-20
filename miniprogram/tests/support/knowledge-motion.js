const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const layout = require('../../subpackages/knowledge/knowledge-subject/graph-layout')

function motionFixture(options = {}) {
  const code = fs.readFileSync(path.join(__dirname, '../../subpackages/knowledge/knowledge-subject/graph-motion.wxs'), 'utf8')
  const module = { exports: {} }
  let clock = 0
  const frames = [], calls = [], state = {}, styles = []
  const rect = { left: 12, top: 180, width: 365, height: 343, ...options.rect }
  const classes = new Set()
  const element = name => ({
    setStyle(value) { this.style = { ...this.style, ...value }; styles.push({ name, value }) },
    getBoundingClientRect: () => rect,
    addClass: value => classes.add(value),
    removeClass: value => classes.delete(value),
  })
  const viewport = element('viewport'), stage = element('stage')
  let dots = [], links = []
  const owner = {
    getState: () => state,
    selectComponent: selector => selector === '.atlas-stage' ? stage : viewport,
    selectAllComponents: selector => selector === '.atlas-node' ? dots : links,
    requestAnimationFrame: callback => frames.push(callback),
    callMethod(name, args) { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }) },
  }
  // WXS exposes Math directly; getDate is its date factory. Do not invent globals
  // here: doing so masked a module-load failure in the actual rendering layer.
  vm.runInNewContext(code, { module, getDate: () => ({ getTime: () => clock }) })
  const motion = module.exports
  const frame = { width: rect.width, height: rect.height }
  const fit = layout.fitCamera(frame)
  const limits = layout.cameraLimits(frame)
  let model = {
    revision: 1, gestureEpoch: 0, preserveMotion: false, active: true, width: frame.width, height: frame.height, ...limits,
    camera: { ...fit, scale: 0.8, ...options.camera },
    nodes: [{ id: 'core', cx: 400, cy: 460, r: 40 }, { id: 'point:2', cx: 300, cy: 300, r: 24 }],
    edges: [{ from: 0, to: 1 }],
  }
  function sync(patch = {}) {
    model = { ...model, ...patch }
    dots = model.nodes.map((_, index) => element('node' + index))
    links = model.edges.map((_, index) => element('edge' + index))
    motion.sync(model, null, owner)
  }
  const touch = (x, y) => ({ clientX: rect.left + x, clientY: rect.top + y })
  const event = (touches, type = 'touchmove', id) => ({ type, touches, currentTarget: { dataset: id ? { nodeId: id, kind: 'point', id: 2 } : {} } })
  function tick(milliseconds = 16) {
    clock += milliseconds
    frames.splice(0).forEach(callback => callback())
  }
  sync()
  tick()
  return { motion, owner, state, calls, styles, stage, classes, rect, touch, event, tick, sync, frames,
    advance: milliseconds => { clock += milliseconds }, get model() { return model },
  }
}

module.exports = { motionFixture }

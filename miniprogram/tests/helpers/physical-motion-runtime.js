const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')

function runtime(entry) {
  let clock = 1000
  const frames = [], calls = [], elements = new Map(), state = {}, modules = new Map()
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, require: relative => load(path.resolve(path.dirname(file), relative)),
      getDate: () => ({ getTime: () => clock }),
    }, { filename: file })
    modules.set(file, module.exports)
    return module.exports
  }
  function node(name) {
    if (!elements.has(name)) elements.set(name, { style: {}, writes: 0,
      setStyle(value) { Object.assign(this.style, value); this.writes++ },
      getComputedStyle() { return { 'box-shadow': '0 2px 8px rgba(12,49,35,0.05)' } },
    })
    return elements.get(name)
  }
  const owner = {
    getState: () => state,
    selectComponent: node,
    requestAnimationFrame: callback => frames.push(callback),
    callMethod: (name, detail) => calls.push({ name, detail: JSON.parse(JSON.stringify(detail)) }),
  }
  const motion = load(path.join(root, entry))
  function tick(ms = 16.667) { clock += ms; frames.splice(0).forEach(callback => callback()) }
  function flush() { for (let i = 0; frames.length && i < 160; i++) tick(); if (frames.length) throw Error('animation did not settle') }
  function event(x, y, type = 'touchmove') {
    return { type, touches: x == null ? [] : [{ clientX: x, clientY: y }],
      currentTarget: { dataset: {} }, instance: node('button') }
  }
  return { motion, owner, state, elements, calls, node, tick, flush, event, frames, load }
}
module.exports = { runtime, root }

// Execute the installed WXML compiler's WXS output, including its real globals.
// This is a compiler-runtime check; it does not emulate the WeChat WebView.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

test('native-compiled graph WXS loads and pans without invented runtime globals', t => {
  const artifact = process.env.KNOWLEDGE_WXML_ARTIFACT
  const compiler = '/mnt/d/Code/WeixinDev/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'
  if (!artifact && !fs.existsSync(compiler)) return t.skip('WeChat WXML compiler is unavailable')
  let source
  if (artifact) source = fs.readFileSync(artifact, 'utf8')
  else {
    const compiled = spawnSync(compiler, [
      'subpackages/knowledge/knowledge-subject/index.wxml',
      'subpackages/knowledge/knowledge-subject/graph-motion.wxs',
    ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000 })
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error || ''))
    source = compiled.stdout
  }
  const marker = "f_['subpackages/knowledge/knowledge-subject/index.wxml']['graphMotion']();"
  assert.ok(source.includes(marker), 'artifact must include the graph WXS module')
  const diagnostics = []
  const context = {
    window: { __webview_engine_version__: 0.02 },
    console: { log: value => diagnostics.push(String(value)), error: value => diagnostics.push(String(value)) },
  }
  vm.createContext(context)
  // Capture the module where the compiler itself initializes it. Its own library
  // supplies Math/getDate; no fake getMath or other WXS built-ins are injected.
  vm.runInContext(source.replace(marker, 'globalThis.graphModule = ' + marker), context)
  vm.runInContext("$gwx('subpackages/knowledge/knowledge-subject/index.wxml')", context)
  assert.deepEqual(diagnostics, [], 'WXS module initialization must not log a swallowed error')
  const motion = context.graphModule
  assert.equal(typeof motion.nv_sync, 'function')

  // Compiler properties are namespaced nv_. Adapt only the host view API/data;
  // arithmetic, arrays, dates and the WXS module run in the compiled VM.
  const encode = value => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return Object.assign(value.map(encode), { nv_length: value.length })
    return Object.fromEntries(Object.entries(value).map(([key, item]) => ['nv_' + key, encode(item)]))
  }
  const decode = value => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return Array.from(value, decode)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/^nv_/, ''), decode(item)]))
  }
  const state = {}, frames = [], calls = [], styles = []
  const stage = { nv_setStyle: value => styles.push(decode(value)) }
  const viewport = {
    nv_getBoundingClientRect: () => encode({ left: 0, top: 0, width: 365, height: 343 }),
    nv_addClass() {}, nv_removeClass() {},
  }
  const owner = {
    nv_getState: () => state,
    nv_selectComponent: selector => selector === '.atlas-stage' ? stage : viewport,
    nv_selectAllComponents: () => [],
    nv_requestAnimationFrame: callback => frames.push(callback),
    nv_callMethod: (name, args) => calls.push({ name, args: decode(args) }),
  }
  motion.nv_sync(encode({
    revision: 1, active: true, width: 365, height: 343, min: 0.4, max: 2,
    camera: { x: -100, y: -150, scale: 0.8 }, nodes: [], edges: [],
  }), null, owner)
  frames.splice(0).forEach(callback => callback())
  const event = (x, y, type) => encode({ type, touches: x == null ? [] : [{ clientX: x, clientY: y }] })
  motion.nv_start(event(100, 100, 'touchstart'), owner)
  motion.nv_move(event(125, 135, 'touchmove'), owner)
  frames.splice(0).forEach(callback => callback())
  assert.equal(calls.length, 0, 'dragging stays in the view layer')
  motion.nv_end(event(null, null, 'touchcancel'), owner)
  assert.deepEqual(calls, [{
    name: 'commitGraphMotion',
    args: { revision: 1, sequence: 1, gestureEpoch: 1, camera: { x: -75, y: -115, scale: 0.8 }, node: null },
  }])
  assert.match(styles.at(-1).transform, /translate3d\(-75px,-115px,0\)/)
})

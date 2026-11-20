const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const compiler = '/mnt/d/Code/WeixinDev/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'

test('real WXS compiler initialises all physical handlers using its own runtime globals', t => {
  if (!fs.existsSync(compiler)) return t.skip('WeChat WXML compiler is unavailable')
  const paths = ['components/motion-sheet/index.wxml','components/motion-sheet/sheet-motion.wxs',
    'components/shared-card-transition/index.wxml','components/shared-card-transition/shared-motion.wxs',
    'utils/motion-physics.wxs','utils/press-motion.wxs','subpackages/study/practice/practice.wxml']
  const compiled = spawnSync(compiler, paths, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4e6 })
  assert.equal(compiled.status, 0, compiled.stderr)
  let source = compiled.stdout
  const targets = [['sheet','components/motion-sheet/index.wxml','motion'],
    ['shared','components/shared-card-transition/index.wxml','motion'],
    ['press','subpackages/study/practice/practice.wxml','press']]
  const context = { window: { __webview_engine_version__: .02 }, console }
  for (const [name,file,module] of targets) {
    const marker = `f_['${file}']['${module}']();`
    assert.ok(source.includes(marker))
    source = source.replace(marker, `globalThis.${name} = ` + marker)
  }
  vm.createContext(context); vm.runInContext(source, context)
  targets.forEach(([,file]) => vm.runInContext(`$gwx('${file}')`, context))
  for (const [name] of targets) assert.equal(typeof (context[name].nv_start || context[name].nv_sync), 'function')
  const encode = value => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return Object.assign(value.map(encode), { nv_length: value.length })
    return Object.fromEntries(Object.entries(value).map(([k,v]) => ['nv_' + k,encode(v)]))
  }
  const frames = [], calls = [], styles = [], state = {}
  const node = { nv_setStyle: value => styles.push(value) }
  const owner = { nv_getState: () => state, nv_selectComponent: () => node,
    nv_requestAnimationFrame: cb => frames.push(cb), nv_callMethod: name => calls.push(name) }
  context.sheet.nv_sync(encode({ active:true, id:1, immediate:true,
    panel:{left:0,top:400,width:390,height:344}, origin:{left:20,top:120,width:120,height:44} }), null, owner)
  assert.equal(typeof frames[0], 'function')
  frames.splice(0).forEach(cb => cb())
  assert.ok(styles.length > 0)
  assert.equal(calls.length,0)
  const inactive = encode({ active:false })
  context.sheet.nv_sync(inactive, null,owner)
  frames.splice(0).forEach(cb=>cb())
  const button = { nv_setStyle: value => styles.push(value),
    nv_getComputedStyle: () => encode({ 'box-shadow': 'none' }) }
  context.press.nv_start({ nv_instance: button, nv_currentTarget: encode({ dataset: {} }) }, owner)
  assert.ok(frames.length > 0)
  frames.splice(0).forEach(cb => cb())
  assert.equal(state.nv_press.nv_shadow, 'none', 'press reads the supported native computed-style API')
})

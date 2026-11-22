const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const compiler = '/mnt/d/Code/WeixinDev/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'

test('native result template paints one reader for review, teacher and guest states', t => {
  if (!fs.existsSync(compiler)) return t.skip('WeChat WXML compiler is unavailable')
  const file = 'subpackages/study/practice-result/index.wxml'
  const compiled = spawnSync(compiler, [file], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4e6 })
  assert.equal(compiled.status, 0, compiled.stderr)
  const context = vm.createContext({ window: { __webview_engine_version__: .02 }, console })
  vm.runInContext(compiled.stdout, context)
  const render = context.$gwx(file)
  const flatten = node => node && typeof node === 'object'
    ? [node, ...(node.children || []).flatMap(flatten)] : []
  const hasClass = (node, name) => String(node.attr && node.attr.class || '').split(/\s+/).includes(name)
  const base = { reviewDialogVisible: true, teacherSheetVisible: false, guestMode: false,
    reviewDialog: { title: '题目复盘', analysisSections: [] } }
  for (const [patch, visible, content] of [
    [{}, true, 'review-dialog-head'],
    [{ teacherSheetVisible: true, teacherLoading: true }, true, 'teacher-sheet-loading'],
    [{ teacherSheetVisible: true, teacherErrorText: '生成失败' }, true, 'teacher-sheet-error'],
    [{ teacherSheetVisible: true, teacherResult: { title: '专项讲解', sections: [], knowledgePoints: [] } }, true, 'teacher-sheet-scroll'],
    [{ teacherSheetVisible: true }, true, 'teacher-action-panel'],
    [{ guestMode: true, teacherSheetVisible: true }, true, 'review-dialog-head'],
    [{ reviewDialogVisible: false, teacherSheetVisible: false }, false, 'review-dialog-head'],
  ]) {
    context.fixtureJSON = JSON.stringify({ ...base, ...patch })
    const nodes = flatten(render(vm.runInContext('JSON.parse(fixtureJSON)', context)))
    const sheets = nodes.filter(node => node.tag === 'wx-motion-sheet')
    assert.equal(sheets.length, 1)
    assert.equal(sheets[0].attr.show, visible)
    assert.equal(nodes.filter(node => hasClass(node, 'motion-sheet-panel')).length, 1)
    assert.equal(nodes.filter(node => hasClass(node, content)).length, 1)
    assert.equal(nodes.filter(node => hasClass(node, 'review-dialog-head') || hasClass(node, 'teacher-sheet-head')).length, 1,
      'only the active reader content is mounted in the slot')
  }
})

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

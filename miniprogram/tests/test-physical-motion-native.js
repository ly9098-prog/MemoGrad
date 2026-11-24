const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const compiler = '/mnt/d/Code/WeixinDev/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'
const teacherContent = 'components/ai-teacher-content/content.wxml'

test('native result template paints one reader for review, teacher and guest states', t => {
  if (!fs.existsSync(compiler)) return t.skip('WeChat WXML compiler is unavailable')
  const file = 'subpackages/study/practice-result/index.wxml'
  const compiled = spawnSync(compiler, [file, teacherContent], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4e6 })
  assert.equal(compiled.status, 0, compiled.stderr)
  const context = vm.createContext({ window: { __webview_engine_version__: .02 }, console })
  vm.runInContext(compiled.stdout, context)
  const render = context.$gwx(file)
  const flatten = node => node && typeof node === 'object'
    ? [node, ...(node.children || []).flatMap(flatten)] : []
  const hasClass = (node, name) => String(node.attr && node.attr.class || '').split(/\s+/).includes(name)
  const base = { reviewDialogVisible: true, teacherSheetVisible: false, guestMode: false,
    reviewDialog: { title: '题目复盘', analysisSections: [] } }
  for (const [patch, visible, content, teacherAction] of [
    [{}, true, 'review-dialog-head'],
    [{ teacherSheetVisible: true, teacherLoading: true }, true, 'teacher-sheet-loading', 'loading'],
    [{ teacherSheetVisible: true, teacherErrorText: '生成失败' }, true, 'teacher-sheet-error', 'retry408Teacher'],
    [{ teacherSheetVisible: true, teacherResult: { title: '专项讲解',
      sections: [{ key: 'concept', heading: '考点', points: ['第一段推导', '第二段推导'] }],
      knowledgePoints: [] } }, true, 'teacher-sheet-scroll', 'show408TeacherActions'],
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
    assert.equal(nodes.filter(node => hasClass(node, content) || node.attr && node.attr.readerClass === content).length, 1)
    assert.equal(nodes.filter(node => hasClass(node, 'review-dialog-head') || hasClass(node, 'teacher-sheet-head')).length, 1,
      'only the active reader content is mounted in the slot')
    if (teacherAction) {
      const footer = nodes.find(node => hasClass(node, 'teacher-sheet-footer'))
      const controls = flatten(footer).filter(node => node.tag === 'wx-button')
      assert.equal(controls.length, 2)
      assert.equal(controls[0].attr.bindtap, 'close408Teacher', 'return preserves the review instead of closing both readers')
      if (teacherAction === 'loading') {
        assert.ok(controls[1].attr.disabled, 'generation must prevent a second action from dispatching')
        assert.equal(controls[1].attr.bindtap, undefined)
      } else assert.equal(controls[1].attr.bindtap, teacherAction)
    }
    if (patch.teacherResult) {
      const points = nodes.find(node => hasClass(node, 'teacher-point-list')).children
        .flatMap(flatten).filter(node => hasClass(node, 'teacher-point-text'))
      assert.equal(points.length, 2)
      assert.equal(points.map(node => node.children.join('')).join('|'), '第一段推导|第二段推导')
      assert.ok(points.every(node => node.attr.userSelect === 'true'), 'shared lesson points remain selectable')
    }
  }
})

test('both teacher pages render shared lessons without losing raw or presented knowledge fields', t => {
  if (!fs.existsSync(compiler)) return t.skip('WeChat WXML compiler is unavailable')
  const files = ['subpackages/study/practice-result/index.wxml',
    'subpackages/study/wrong-detail/wrong-detail.wxml']
  const compiled = spawnSync(compiler, [...files, teacherContent, 'components/ai-teacher-content/actions.wxml'],
    { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4e6 })
  assert.equal(compiled.status, 0, compiled.stderr)
  const context = vm.createContext({ window: { __webview_engine_version__: .02 }, console })
  vm.runInContext(compiled.stdout, context)
  const flatten = node => node && typeof node === 'object'
    ? [node, ...(node.children || []).flatMap(flatten)] : []
  const hasClass = (node, name) => String(node.attr && node.attr.class || '').split(/\s+/).includes(name)
  const text = node => (node.children || []).map(child =>
    typeof child === 'object' ? text(child) : String(child)).join('')
  const lesson = { title: '条件变量', summary: '先阻塞，再让出管程',
    sections: [{ key: 'wait', heading: 'wait 的语义', points: ['释放互斥权', '进入等待队列'] }],
    practiceQuestion: { stem: 'wait 会保留互斥权吗？', options: [{ key: 'A', text: '不会' }],
      answer: 'A', analysis: '其他进程需要进入管程改变条件。' } }
  const knowledgeFixtures = [
    { key: 'raw', name: '条件变量', relation: '相关知识：管程', masteryHint: '建议复习入口互斥' },
    { key: 'presented', name: '条件变量', relationItems: [{ key: 'parent', label: '所属主题', value: '管程' }],
      masteryText: '还需巩固 · 50%', learningHint: '建议复习入口互斥' },
  ]
  for (const file of files) for (const knowledge of knowledgeFixtures) {
    const render = context.$gwx(file)
    context.fixtureJSON = JSON.stringify({ teacherSheetVisible: true, reviewDialog: {}, wq: {},
      teacherResult: { ...lesson, knowledgePoints: [knowledge] } })
    const nodes = flatten(render(vm.runInContext('JSON.parse(fixtureJSON)', context)))
    const body = nodes.find(node => hasClass(node, 'teacher-content'))
    assert.ok(body, `${file} renders the shared lesson`)
    const bodyNodes = flatten(body)
    assert.equal(bodyNodes.filter(node => hasClass(node, 'teacher-result-point')).length, 2)
    assert.ok(text(body).includes(knowledge.learningHint || knowledge.masteryHint))
    assert.ok(text(body).includes(knowledge.relation || '所属主题管程'))
    if (knowledge.masteryText) assert.ok(text(body).includes(knowledge.masteryText))
    for (const name of ['teacher-summary', 'teacher-point-text', 'teacher-practice-stem',
      'teacher-practice-option-text', 'teacher-practice-analysis']) {
      const contentNodes = bodyNodes.filter(node => hasClass(node, name))
      assert.equal(contentNodes.length, name === 'teacher-point-text' ? 2 : 1,
        `${file} must render ${name} before checking selectability`)
      assert.ok(contentNodes.every(node => node.attr.userSelect === 'true'))
    }
    assert.ok(text(body).includes(lesson.practiceQuestion.analysis))
    assert.ok(text(body).includes(file.includes('practice-result') ? '专项 AI 老师' : 'AI 深入讲解'))
  }
  for (const file of files) {
    context.fixtureJSON = JSON.stringify({ teacherSheetVisible: true, reviewDialog: {}, wq: {},
      teacherLastAction: 'explain_correct', aiAvailabilityEnabled: true,
      teacherResult: { title: '讲解未生成', summary: '请稍后重试', fromFallback: true,
        sections: [], knowledgePoints: [], practiceQuestion: null } })
    const nodes = flatten(context.$gwx(file)(vm.runInContext('JSON.parse(fixtureJSON)', context)))
    const body = nodes.find(node => hasClass(node, 'teacher-content'))
    assert.ok(body)
    assert.ok(text(body).includes('生成状态请稍后重试'))
    assert.equal(flatten(body).filter(node => hasClass(node, 'teacher-result-section')).length, 0)
    assert.equal(flatten(body).filter(node => hasClass(node, 'teacher-footnote')).length, 0,
      'fallback shows its status and retry control without a redundant footnote')
    assert.ok(nodes.some(node => node.attr && node.attr.bindtap ===
      (file.includes('practice-result') ? 'retry408Teacher' : 'run408TeacherAction')))
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

// Run: node miniprogram/tests/test-dashboard-compile-compat.js [babelRoot] [compiledDashboard]
// Reuse installed Babel tooling (or Admin's bundled Babel); no miniapp runtime dependency.
// Default: always test source behavior; skip compilation if tools are absent. Explicit args are strict.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const test = require('node:test')

const filename = path.resolve(__dirname, '../pages/dashboard/dashboard.js')
const babelRoot = path.resolve(process.argv[2] || path.join(__dirname, '../../admin-frontend'))
const strictIntegration = process.argv.length > 2
function resolveTool(name, bundledName) {
  try { return require.resolve(name, { paths: [babelRoot] }) } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    if (bundledName) {
      try { return require.resolve(`next/dist/compiled/babel/${bundledName}`, { paths: [babelRoot] }) } catch (fallbackError) {
        if (fallbackError.code !== 'MODULE_NOT_FOUND') throw fallbackError
      }
    }
    const missing = new Error(`Optional Babel tool ${name} is unavailable under ${babelRoot}`)
    missing.code = 'DASHBOARD_BABEL_UNAVAILABLE'
    throw missing
  }
}
function loadCompiler() {
  const babel = require(resolveTool('@babel/core'))
  const preset = resolveTool('@babel/preset-env', 'preset-env')
  const runtime = resolveTool('@babel/plugin-transform-runtime', 'plugin-transform-runtime')
  const commonjs = resolveTool('@babel/plugin-transform-modules-commonjs', 'plugin-transform-modules-commonjs')
  return {
    version: babel.version,
    compile(source) {
      return babel.transformSync(source, {
        filename, babelrc: false, configFile: false,
        presets: [[preset, {
          targets: { chrome: 53, ios: 8 }, modules: false,
          include: ['@babel/plugin-transform-computed-properties'],
        }]],
        plugins: [
          [runtime, { corejs: false, helpers: true, regenerator: true, version: '7.21.0' }],
          [commonjs, { importInterop: name => name.startsWith('@babel/runtime/helpers/') ? 'node' : 'babel' }],
        ],
      }).code
    },
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const quietConsole = { log() {}, warn() {}, error() {} }

function harness(code, request = deferred()) {
  let definition
  const calls = []
  const patches = []
  const runtimeModules = new Map()
  function loadRuntime(name, parentFile) {
    let file
    if (name.startsWith('.')) {
      file = path.resolve(path.dirname(parentFile), name)
      if (!path.extname(file)) file += '.js'
    } else {
      // The DevTools vendor copy uses the exact './arrayWithHoles' in the report.
      const vendor = path.join(babelRoot, 'js/common/miniprogram-builder/vendor/babel_runtime',
        name.replace(/^@babel\/runtime\//, '') + '.js')
      if (fs.existsSync(vendor)) file = vendor
      else {
        try { file = require.resolve(name, { paths: [babelRoot] }) } catch (error) {
          if (error.code !== 'MODULE_NOT_FOUND') throw error
          file = require.resolve(`next/dist/compiled/${name}`, { paths: [babelRoot] })
        }
      }
    }
    if (path.basename(file) === 'arrayWithHoles.js') {
      throw new Error(`module '@babel/runtime/helpers/arrayWithHoles.js' is not defined, require args is '${name}'`)
    }
    if (runtimeModules.has(file)) return runtimeModules.get(file).exports
    const module = { exports: {} }
    runtimeModules.set(file, module)
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, exports: module.exports, require: value => loadRuntime(value, file),
    }, { filename: file })
    return module.exports
  }
  vm.runInNewContext(code, {
    Page(value) { definition = value },
    require(name) {
      const helper = name.replace(/^(?:\.\.\/)+(?=@babel\/runtime\/)/, '')
      if (helper.startsWith('@babel/runtime/')) return loadRuntime(helper)
      if (name === '../../utils/api') {
        return { get(url, params) { calls.push({ url, params }); return request.promise } }
      }
      return require(path.resolve(path.dirname(filename), name))
    },
    wx: {}, setTimeout, clearTimeout, console: quietConsole,
  }, { filename })
  assert(definition, 'dashboard registers Page even when arrayWithHoles is unavailable')
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      patches.push(patch)
      Object.assign(this.data, patch)
      if (callback) callback()
    },
  })
  page.onLoad({})
  page._alive = true
  page._visible = true
  page._knowledgeDiagnosisSeq = 1
  return { page, request, calls, patches }
}

function diagnosis(id) {
  return {
    subject_id: id, subject_name: `学科${id}`, period_days: 30,
    primary_recommendation: { knowledge_point_id: id * 10, title: `章节${id}` },
    report: { session_count: 3, question_count: 8 },
  }
}
function fetchDiagnosis(h, closed) {
  return h.page._fetchKnowledgeDiagnosis(301, { knowledgeDiagnosisSubjectName: '数据结构' }, closed, 1)
}

async function checkBehavior(code) {
  let h = harness(code)
  let closed = deferred()
  let pending = fetchDiagnosis(h, closed.promise)
  assert.strictEqual(h.calls.length, 1, 'request starts while sheet exit is pending')
  assert.strictEqual(h.calls[0].url, '/study-hub/knowledge-diagnosis')
  assert.strictEqual(h.calls[0].params.subject_id, 301)
  assert.strictEqual(h.calls[0].params.days, 30)
  h.request.resolve(diagnosis(301))
  await tick()
  assert.strictEqual(h.page.data.knowledgeDiagnosis, null, 'fast response waits for sheet exit')
  closed.resolve()
  let snapshot = await pending
  assert.strictEqual(snapshot.subjectId, 301, 'uses the API result from Promise.all, not the exit result')
  assert.strictEqual(snapshot.report.questionCount, 8)
  assert.strictEqual(h.page._knowledgeDiagnosisCache.get(301).snapshot, snapshot)
  assert.strictEqual(h.page.data.knowledgeDiagnosis, snapshot)
  assert(!h.patches.some(patch => patch.knowledgeDiagnosisLoading === true), 'fast response skips skeleton')

  h = harness(code)
  closed = deferred()
  pending = fetchDiagnosis(h, closed.promise)
  closed.resolve()
  await tick()
  assert.strictEqual(h.page.data.knowledgeDiagnosisLoading, true, 'slow response shows loading after exit')
  h.request.resolve(diagnosis(301))
  await pending
  assert.strictEqual(h.page.data.knowledgeDiagnosis.subjectId, 301)
  assert.strictEqual(h.page.data.knowledgeDiagnosisLoading, false)

  h = harness(code)
  closed = deferred()
  pending = fetchDiagnosis(h, closed.promise)
  h.request.reject(new Error('network'))
  await tick()
  assert.strictEqual(h.page.data.knowledgeDiagnosisError, '', 'fast failure also waits for exit')
  closed.resolve()
  assert.strictEqual(await pending, null)
  assert.strictEqual(h.page.data.knowledgeDiagnosisError, '章节诊断暂不可用')
  assert.strictEqual(h.page.data.knowledgeDiagnosisLoading, false)

  for (const invalidate of [page => page.onHide(), page => page.onUnload(), page => { page._knowledgeDiagnosisSeq++ }]) {
    h = harness(code)
    closed = deferred()
    pending = fetchDiagnosis(h, closed.promise)
    invalidate(h.page)
    const patchCount = h.patches.length
    closed.resolve()
    h.request.resolve(diagnosis(301))
    assert.strictEqual(await pending, null)
    assert.strictEqual(h.patches.length, patchCount, 'hidden, unloaded or superseded request cannot update page')
    assert.strictEqual(h.page._knowledgeDiagnosisCache.size, 0)
  }

  h = harness(code)
  pending = fetchDiagnosis(h, null)
  assert.strictEqual(h.page.data.knowledgeDiagnosisLoading, true, 'initial load works without a sheet')
  h.request.resolve(diagnosis(301))
  snapshot = await pending
  assert.strictEqual(snapshot.subjectId, 301)
  assert.strictEqual(h.page.data.knowledgeDiagnosisLoading, false)
}

test('dashboard source: fast/slow/error/invalidated/initial diagnosis requests', () =>
  checkBehavior(fs.readFileSync(filename, 'utf8')))

test('dashboard compiled: missing-helper negative control, Page loading and diagnosis requests', async t => {
  let compiler
  try { compiler = loadCompiler() } catch (error) {
    if (strictIntegration || error.code !== 'DASHBOARD_BABEL_UNAVAILABLE') throw error
    t.skip(error.message)
    return
  }
  const trigger = compiler.compile('Page({ async load(request, ready) { const [raw] = await Promise.all([request, ready]); return raw } })')
  assert.throws(() => harness(trigger), /arrayWithHoles\.js.*is not defined/,
    'negative control must reproduce the missing transitive helper during module loading')
  const code = process.argv[3]
    ? fs.readFileSync(path.resolve(process.argv[3]), 'utf8')
    : compiler.compile(fs.readFileSync(filename, 'utf8'))
  await checkBehavior(code)
  t.diagnostic(`Babel ${compiler.version}`)
})

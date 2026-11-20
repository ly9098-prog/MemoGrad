const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  let definition, measurement
  const pending = [], patches = []
  const session = { token: 'fixture' }
  const api = { request(...args) { const task = deferred(); pending.push({ ...task, args }); return task.promise } }
  const wx = {
    getWindowInfo: () => ({ windowHeight: 844 }),
    createSelectorQuery() {
      return { in() { return this }, select() { return this }, boundingClientRect() { return this },
        exec(callback) { measurement = callback } }
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../subpackages/formulas/library/index.js'), 'utf8'), {
    Page: value => { definition = value }, wx, console, clearTimeout, setTimeout,
    require(name) {
      if (name.endsWith('/api')) return api
      if (name.endsWith('formula-reader-state')) return { sessionIdentity: () => session, sameSession: value => value === session }
      return {}
    },
  })
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch, callback) { patches.push(structuredClone(patch)); Object.assign(this.data, patch); if (callback) callback() },
    loadCatalog() {}, decorateFormulaItems: rows => rows,
  }
  Object.assign(page.data, { initialLoading: false, contentReady: true, formulas: [{ id: 1 }], page: 2, total: 40 })
  page._scrollTop = 1000
  return { page, pending, patches, measure(rect = { top: -740, height: 2200 }) { if (measurement) measurement([rect]) } }
}

const change = (page, type) => page.onLibraryTypeChange({ currentTarget: { dataset: { type } } })
const settle = () => new Promise(resolve => setImmediate(resolve))

test('a library switch reserves the visible list footprint before clearing its data', async () => {
  const h = fixture()
  change(h.page, 'function_graph')
  h.measure()
  const cleared = h.patches.find(patch => Array.isArray(patch.formulas) && !patch.formulas.length)
  assert.ok(cleared && cleared.resultsMinHeight >= 1584, 'the scrolled viewport stays inside the result shell during loading')
  assert.equal(h.page.data.contentReady, true, 'loading another list does not restart page entry')
  h.pending[0].resolve({ items: [{ id: 2, isFunctionGraph: true }], total: 1 })
  await settle()
  assert.equal(h.page.data.formulas[0].id, 2)
  assert.ok(h.page.data.resultsMinHeight >= 1584, 'a shorter response must not clamp the current scroll position')
  h.page.onPageScroll({ scrollTop: 0 })
  assert.ok(h.page.data.resultsMinHeight < 844, 'scrolling back to the top releases retained space')
})

test('changing library supersedes pagination without getting stuck behind loadingMore', async () => {
  const h = fixture()
  const old = h.page.loadFormulas(false)
  assert.equal(h.pending.length, 1)
  change(h.page, 'function_graph')
  h.measure()
  assert.equal(h.pending.length, 2, 'the new library starts while the old pagination is pending')
  h.pending[1].resolve({ items: [{ id: 2, isFunctionGraph: true }], total: 1 })
  await settle()
  h.pending[0].resolve({ items: [{ id: 99 }], total: 40 })
  await old
  assert.deepEqual(Array.from(h.page.data.formulas, item => item.id), [2])
  assert.equal(h.page.data.initialLoading, false)
  assert.equal(h.page.data.loadingMore, false)
})

test('the latest rapid type switch wins both its measurement and network response', async () => {
  const h = fixture()
  change(h.page, 'function_graph'); h.measure()
  change(h.page, 'formula'); h.measure()
  assert.equal(h.pending.length, 2)
  h.pending[1].resolve({ items: [{ id: 3 }], total: 1 })
  await settle()
  h.pending[0].resolve({ items: [{ id: 99, isFunctionGraph: true }], total: 1 })
  await settle()
  assert.equal(h.page.data.activeLibraryType, 'formula')
  assert.deepEqual(Array.from(h.page.data.formulas, item => item.id), [3])
})

test('a measurement arriving after unload does not switch or load the page', () => {
  const h = fixture()
  change(h.page, 'function_graph')
  h.page.onUnload()
  const count = h.patches.length
  h.measure()
  assert.equal(h.patches.length, count)
  assert.equal(h.pending.length, 0)
})

test('a quick return to the current tab cancels a pending measurement', () => {
  const h = fixture()
  change(h.page, 'function_graph')
  change(h.page, 'formula')
  h.measure()
  assert.equal(h.page.data.activeLibraryType, 'formula')
  assert.equal(h.pending.length, 0)
})

test('hide invalidates a measurement even if the page becomes visible before it replies', () => {
  const h = fixture()
  change(h.page, 'function_graph')
  h.page.onHide()
  h.page._visible = true
  h.measure()
  assert.equal(h.page.data.activeLibraryType, 'formula')
  assert.equal(h.pending.length, 0)
})

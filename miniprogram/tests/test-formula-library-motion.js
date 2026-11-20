const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const filename = path.join(root, 'subpackages/formulas/library/index.js')
const requireLibrary = createRequire(filename)
const source = fs.readFileSync(filename, 'utf8')
// KaTeX/parser runtime detection needs only these platform capabilities.
global.wx = {
  getWindowInfo: () => ({ windowWidth: 375 }),
  getDeviceInfo: () => ({ system: 'Node test' }),
  getStorageSync: () => '',
}

function fixture({ ready = true } = {}) {
  let definition
  const requests = [], commits = [], measurements = [], patches = []
  const session = {}
  let activeSession = session
  const wx = {
    createSelectorQuery() {
      return {
        in() { return this },
        selectAll(selector) { assert.equal(selector, '.fl-list-entry-pending'); return this },
        fields(options) { assert.ok(options.dataset && options.size); return this },
        exec(callback) { measurements.push(callback) },
      }
    },
  }
  vm.runInNewContext(source, {
    wx, console, setTimeout, clearTimeout, Page: value => { definition = value },
    require(name) {
      if (name.endsWith('/api')) return { request() { return new Promise(resolve => requests.push(resolve)) } }
      if (name.endsWith('/auth')) return { isLoggedIn: () => false }
      if (name.endsWith('formula-reader-state')) return { sessionIdentity: () => activeSession, sameSession: value => value === activeSession }
      return requireLibrary(name)
    },
  })
  const page = {
    ...definition, data: structuredClone(definition.data), syncReaderMode() {}, loadFavoriteIds() {},
    _librarySession: session,
    setData(patch, callback) {
      patches.push(structuredClone(patch))
      for (const [key, value] of Object.entries(patch)) {
        const field = key.match(/^formulas\[(\d+)\]\.(\w+)$/)
        if (field) this.data.formulas[Number(field[1])][field[2]] = value
        else this.data[key] = value
      }
      if (callback) commits.push(() => callback.call(this))
    },
  }
  if (ready && page.onReady) page.onReady()
  return {
    page, requests, commits, measurements, patches,
    changeSession() { activeSession = {} },
    commit() { commits.splice(0).forEach(callback => callback()) },
    measure(rows) {
      assert.ok(measurements.length, 'entry waits for a native layout measurement')
      measurements.shift()([rows || page.data.formulas.map(item => ({
        dataset: { entryKey: item._entryKey }, width: 320, height: 120,
      }))])
    },
  }
}

async function load(h, items, replace = true, total = items.length) {
  const request = h.page.loadFormulas(replace)
  h.requests.shift()({ items, total })
  await request
}

test('real decorated titles distinguish text nodes from math and formatted HTML', () => {
  const h = fixture()
  const rows = h.page.decorateFormulaItems([
    { id: 1, title: '函数单调性判断' }, { id: 2, title: '二次函数 y=ax^2+bx+c' },
    { id: 3, title: '<b>重点结论</b>' }, { id: 4, title: '第一行\n第二行' },
    { id: 5, title: '<span style="color:#123456">格式标题</span>' },
  ])
  assert.equal(rows[0].titleNodes.length, 1, 'nonempty parser output alone does not imply rich text')
  assert.equal(rows[0].titleIsRich, false)
  assert.equal(rows[0].titleText, rows[0].titleNodes[0].text)
  assert.equal(rows[1].titleIsRich, true)
  assert.match(JSON.stringify(rows[1].titleNodes), /katex/)
  assert.equal(rows[2].titleIsRich, true, 'formatted title markup is preserved')
  assert.equal(rows[3].titleText, '第一行 第二行', 'plain text preserves the parser normalization')
  assert.equal(rows[4].titleIsRich, true, 'styled markup keeps its native rich-text tree')
  assert.match(JSON.stringify(rows[4].titleNodes), /color:#123456/)
})

test('slow data waits for its view commit and measured nodes instead of an entry timer', async () => {
  const h = fixture()
  const request = h.page.loadFormulas(true)
  assert.equal(h.measurements.length, 0)
  h.requests.shift()({ items: [{ id: 1, title: '网络分层' }], total: 1 })
  await request
  assert.equal(h.page.data.formulas[0]._entryState, 'pending')
  assert.equal(h.measurements.length, 0, 'setData has not yet committed the new nodes')
  h.commit()
  assert.equal(h.page.data.formulas[0]._entryState, 'pending')
  h.measure()
  assert.equal(h.page.data.formulas[0]._entryState, 'running')
})

test('data arriving before onReady does not consume its entrance', async () => {
  const h = fixture({ ready: false })
  await load(h, [{ id: 1, title: '先到的数据' }])
  h.commit()
  assert.equal(h.measurements.length, 0)
  h.page.onReady()
  h.measure()
  assert.equal(h.page.data.formulas[0]._entryState, 'running')
})

test('a response received while hidden reveals only after the page is shown and measured', async () => {
  const h = fixture()
  const request = h.page.loadFormulas(true)
  h.page.onHide()
  h.requests.shift()({ items: [{ id: 1, title: '隐藏后才返回' }], total: 1 })
  await request
  h.commit()
  assert.equal(h.measurements.length, 0)
  assert.equal(h.page.data.formulas[0]._entryState, 'pending')
  h.page.onShow()
  h.measure()
  assert.equal(h.page.data.formulas[0]._entryState, 'running')
})

test('new pagination rows stagger from zero and duplicate/existing rows keep their state', async () => {
  const h = fixture()
  await load(h, Array.from({ length: 20 }, (_, index) => ({ id: index + 1, title: '条目' + index })), true, 50)
  h.commit(); h.measure()
  const oldRow = h.page.data.formulas[0]
  await load(h, [{ id: 20, title: '重复条目' }, { id: 21, title: '追加一' }, { id: 22, title: '追加二' }], false, 50)
  assert.equal(h.page.data.formulas[0], oldRow)
  assert.equal(h.page.data.formulas.length, 22)
  assert.deepEqual(Array.from(h.page.data.formulas.slice(20), item => item._entryDelay), [0, 42])
  assert.equal(oldRow._entryState, 'running')
  h.commit(); h.measure()
  assert.deepEqual(Array.from(h.page.data.formulas.slice(20), item => item._entryState), ['running', 'running'])
})

test('favorite writes and onShow do not replay an already revealed keyed row', async () => {
  const h = fixture()
  await load(h, [{ id: 1, title: '已经显示的标题' }])
  h.commit(); h.measure()
  const before = h.page.data.formulas[0]
  h.page.onFormulaEntryEnd({ currentTarget: { dataset: { entryKey: before._entryKey } }, detail: { animationName: 'fl-list-entry-rise' } })
  h.page.setData({ formulas: h.page.data.formulas.map(item => ({ ...item, isFavorited: true })) })
  h.page.onHide(); h.page.onShow()
  assert.equal(h.page.data.formulas[0]._entryState, 'done')
  assert.equal(h.page.data.formulas[0]._entryKey, before._entryKey)
  assert.equal(h.measurements.length, 0)
})

test('hide, replacement and unload reject late layout callbacks', async () => {
  for (const action of ['hide', 'replace', 'unload']) {
    const h = fixture()
    await load(h, [{ id: 1, title: '旧批次' }])
    h.commit()
    const old = h.measurements.shift()
    const key = h.page.data.formulas[0]._entryKey
    if (action === 'hide') h.page.onHide()
    if (action === 'unload') h.page.onUnload()
    if (action === 'replace') await load(h, [{ id: 1, title: '同 ID 新批次' }])
    const count = h.patches.length
    old([[{ dataset: { entryKey: key }, width: 320, height: 100 }]])
    assert.equal(h.patches.length, count, action)
    assert.equal(h.page.data.formulas[0]._entryState, 'pending')
    if (action === 'replace') {
      h.commit(); h.measure()
      h.page.onFormulaEntryEnd({ currentTarget: { dataset: { entryKey: key } }, detail: { animationName: 'fl-list-entry-rise' } })
      assert.equal(h.page.data.formulas[0]._entryState, 'running', 'old completion cannot finish a new batch with the same ID')
    }
  }
})

test('zero-size and unrelated measurements never start an unconfirmed row', async () => {
  const h = fixture()
  await load(h, [{ id: 1, title: '等待真实节点' }])
  h.commit()
  const key = h.page.data.formulas[0]._entryKey
  h.measure([{ dataset: { entryKey: key }, width: 0, height: 100 }, { dataset: { entryKey: 'stale' }, width: 320, height: 100 }])
  assert.equal(h.page.data.formulas[0]._entryState, 'pending')
  h.page.onShow(); h.measure()
  assert.equal(h.page.data.formulas[0]._entryState, 'running')
})

test('late layout and animation events cannot write across an account change', async () => {
  const h = fixture()
  await load(h, [{ id: 1, title: '旧会话' }])
  h.commit()
  const key = h.page.data.formulas[0]._entryKey
  h.changeSession()
  const count = h.patches.length
  h.measure()
  h.page.onFormulaEntryEnd({ currentTarget: { dataset: { entryKey: key } }, detail: { animationName: 'fl-list-entry-rise' } })
  assert.equal(h.patches.length, count)
  assert.equal(h.page.data.formulas[0]._entryState, 'pending')
})

test('title rich-text has no translating ancestor and local effects honor reduced motion', () => {
  const template = fs.readFileSync(path.join(root, 'subpackages/formulas/library/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(root, 'subpackages/formulas/library/index.wxss'), 'utf8')
  assert.doesNotMatch(template, /fl-content[^\n]*route-enter-page/)
  assert.match(template, /wx:key="id"[^\n]*fl-list-entry/)
  assert.match(template, /wx:if="\{\{item\.titleIsRich\}\}"/)
  assert.match(template, /hover-class="\{\{item\.titleIsRich \? 'motion-content-pressed' : 'fl-card-pressed'\}\}"/)
  assert.doesNotMatch(template, /class="motion-list-item/)
  assert.match(template, /animation-delay:\{\{item\._entryDelay\}\}ms/)
  const fade = styles.match(/@keyframes fl-list-entry-fade\s*\{[\s\S]*?\n\}/)
  assert.ok(fade)
  assert.doesNotMatch(fade[0], /transform/)
  assert.match(styles, /@keyframes fl-list-entry-rise[\s\S]*translate3d/)
  assert.match(styles, /prefers-reduced-motion[\s\S]*fl-list-entry[\s\S]*animation:\s*none\s*!important/)
})

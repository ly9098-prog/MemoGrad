const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function fixture(file = 'components/fit-scroll/index.js') {
  let definition
  const ticks = [], queries = [], events = [], timers = []
  vm.runInNewContext(read(file), {
    Component(value) { definition = value },
    wx: { nextTick(fn) { ticks.push(fn) } },
    setTimeout(fn) { timers.push(fn); return timers.length },
    clearTimeout(id) { if (id) timers[id - 1] = null },
  })
  const instance = {
    data: { ...definition.data },
    setData(patch, done) { Object.assign(this.data, patch); if (done) done() },
    triggerEvent(...args) { events.push(args) },
    createSelectorQuery() {
      return { select(selector) {
        assert.equal(selector, file.includes('motion-sheet') ? '.motion-sheet-shell' : '.fit-scroll-content')
        return this
      }, boundingClientRect() { return this }, exec(done) { queries.push(done) } }
    },
  }
  Object.assign(instance, definition.methods)
  return { definition, instance, ticks, queries, events, timers,
    flush() { while (ticks.length) ticks.shift()() } }
}

test('reader measures natural content and not its constrained viewport', () => {
  const f = fixture()
  f.definition.lifetimes.attached.call(f.instance)
  f.flush()
  f.queries.shift()([{ width: 300, height: 152.2 }])
  assert.equal(f.instance.data.contentHeight, 153)
  assert.equal(f.events[0][0], 'readerresize')
  assert.equal(f.events[0][2].composed, true)
  f.definition.properties.content.observer.call(f.instance)
  f.flush()
  f.queries.shift()([{ width: 300, height: 2400 }])
  assert.equal(f.instance.data.contentHeight, 2400)
  const markup = read('components/fit-scroll/index.wxml')
  assert.match(markup, /height:\{\{contentHeight\}\}px/)
  assert.match(markup, /<view class="fit-scroll-content"><slot\s*\/>/)
  assert.match(read('components/fit-scroll/index.wxss'), /flex:\s*0 1 auto/)
})

test('async updates coalesce and detached or superseded measurements cannot win', () => {
  const f = fixture()
  f.definition.lifetimes.attached.call(f.instance)
  f.flush()
  const stale = f.queries.shift()
  f.definition.properties.content.observer.call(f.instance)
  f.definition.properties.content.observer.call(f.instance)
  f.flush()
  assert.equal(f.queries.length, 1)
  stale([{ width: 300, height: 999 }])
  assert.equal(f.instance.data.contentHeight, 1)
  f.queries.shift()([{ width: 300, height: 120 }])
  assert.equal(f.instance.data.contentHeight, 120)
  f.definition.pageLifetimes.resize.call(f.instance)
  f.flush()
  f.definition.lifetimes.detached.call(f.instance)
  f.queries.shift()([{ width: 300, height: 999 }])
  assert.equal(f.instance.data.contentHeight, 120)
})

test('sheet remeasures an updated reader but never interrupts dismissal', () => {
  const f = fixture('components/motion-sheet/index.js')
  f.instance._attached = true
  f.instance.data.rendered = true
  f.instance.properties = { show: true, closing: false }
  let measured = 0
  f.instance.measure = immediate => { assert.equal(immediate, true); measured++ }
  f.instance.onReaderResize(); f.flush()
  assert.equal(measured, 1)
  for (const state of [{ closing: true }, { show: false }]) {
    f.instance.properties = { show: true, closing: false, ...state }
    f.instance.onReaderResize(); f.flush()
  }
  f.instance.properties = { show: true, closing: false }
  f.instance.data.command = { close: true }
  f.instance.onReaderResize(); f.flush()
  assert.equal(measured, 1)
})

test('a pending layout query cannot cancel closing or overwrite a quick reopen', () => {
  for (const reopen of [false, true]) {
    const f = fixture('components/motion-sheet/index.js')
    const sheet = f.instance
    sheet._attached = true
    sheet._sequence = 4
    sheet.data.rendered = true
    sheet.data.command = { id: 4, active: true, close: false }
    sheet.properties = { show: true, closing: false }
    sheet.measure(true)
    const pending = f.queries.shift()
    sheet.beginClose(true)
    assert.equal(sheet.data.command.close, true)
    if (reopen) sheet.syncVisibility()
    const id = sheet.data.command.id
    pending([{ width: 320, height: 400, top: 168, left: 0 }])
    assert.equal(sheet.data.command.id, id)
    assert.equal(sheet.data.command.close, !reopen)
    if (reopen) {
      assert.equal(sheet.data.rendered, true)
      assert.equal(sheet._closeTimer, null)
    } else {
      f.timers.find(Boolean)()
      assert.equal(sheet.data.rendered, false)
      assert.equal(sheet._closeTimer, null)
      assert.deepEqual(f.events.map(event => event[0]), ['close', 'closed'])
    }
  }
})

test('all teacher surfaces fit their body while ordinary review keeps its fixed frame', () => {
  for (const base of ['subpackages/study/practice-result/index',
    'subpackages/study/wrong-detail/wrong-detail', 'subpackages/exam/result/index']) {
    const markup = read(base + '.wxml'), css = read(base + '.wxss')
    assert.match(markup, /<fit-scroll reader-class="teacher-sheet-scroll" content=/)
    assert.doesNotMatch(css, /\.teacher-sheet\s*\{[^{}]*min-height:\s*38vh/)
    assert.doesNotMatch(css, /\.teacher-sheet-scroll\s*\{[^{}]*flex:\s*1 1 auto/)
    assert.equal(JSON.parse(read(base + '.json')).usingComponents['fit-scroll'], '/components/fit-scroll/index')
  }
  assert.match(read('subpackages/study/practice-result/index.wxss'), /\.result-reader-sheet\.review-dialog-sheet\{height:/)
})

test('old summary-only responses become truthful uncached failures', () => {
  const teacher = require('../subpackages/study/utils/ai-teacher-408')
  for (const action of ['explain_correct', 'core_concept', 'connect_knowledge', 'high_frequency_traps']) {
    const result = teacher.normalizeResult({ action, title: '编码能力', summary: '再由公式', from_fallback: false })
    assert.equal(result.fromFallback, true)
    assert.match(result.summary, /未收到可展示的讲解正文/)
    assert.deepEqual(result.sections, [])
  }
  const complete = teacher.normalizeResult({ action: 'explain_correct', summary: '结论。',
    sections: [{ heading: '公式', points: ['检错能力为最小距离减一。'] }] })
  assert.equal(complete.fromFallback, false)
  assert.equal(complete.sections[0].points[0], '检错能力为最小距离减一。')
})

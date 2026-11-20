const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { runtime } = require('./helpers/physical-motion-runtime')

function sheetHarness(overrides = {}, anchorRect = { left: 30, top: 132, width: 300, height: 48 }) {
  let definition, serial = 0
  const timers = new Map(), events = []
  const panel = { left: 0, top: 420, width: 390, height: 360 }
  const source = fs.readFileSync(path.join(__dirname, '../components/motion-sheet/index.js'), 'utf8')
  vm.runInNewContext(source, {
    Component: value => { definition = value },
    setTimeout: callback => { timers.set(++serial, callback); return serial },
    clearTimeout: id => timers.delete(id),
    wx: { createSelectorQuery: () => ({
      select() { return this },
      boundingClientRect(callback) { this.callback = callback; return this },
      exec() { this.callback(anchorRect) },
    }) },
  })
  const properties = Object.fromEntries(Object.entries(definition.properties).map(([key, value]) => [key, value.value]))
  const sheet = {
    ...definition.methods, properties: { ...properties, ...overrides }, data: { ...definition.data },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { if (name === 'close') events.push({ name, completed: detail.completed }) },
    createSelectorQuery() { return { select() { return this }, boundingClientRect() { return this }, exec(callback) { callback([panel]) } } },
  }
  definition.lifetimes.attached.call(sheet)
  const update = patch => { Object.assign(sheet.properties, patch); sheet.syncVisibility() }
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
  return { sheet, update, flush, definition, events, timers }
}

test('Dock morphs shrink to an 8px point at the subject entry centre, regardless of entry width', () => {
  const h = sheetHarness({ show: true, anchor: '#subject-entry', variant: 'dock' })
  const command = h.sheet.data.command
  assert.equal(command.origin.width, 8)
  assert.equal(command.origin.height, 8)
  assert.equal(command.origin.left + command.origin.width / 2, 180)
  assert.equal(command.origin.top + command.origin.height / 2, 156)
  const view = runtime('components/motion-sheet/sheet-motion.wxs')
  view.motion.sync(command, null, view.owner); view.flush()
  assert.equal(view.state.p, 1)
  h.update({ show: false })
  view.motion.sync(h.sheet.data.command, command, view.owner); view.flush()
  assert.equal(view.state.p, 0)
  const scale = view.node('.motion-sheet-surface').style.transform.match(/scale\(([^,]+),([^\)]+)\)/)
  assert.ok(Math.abs(Number(scale[1]) * command.panel.width - 8) < 0.001)
  assert.ok(Math.abs(Number(scale[2]) * command.panel.height - 8) < 0.001)
  assert.deepEqual(view.calls.map(call => call.name), ['finishClose'])
})

test('ordinary anchored sheets retain their measured capsule and missing Dock anchors slide normally', () => {
  const ordinary = sheetHarness({ show: true, anchor: '#entry' }).sheet.data.command
  assert.equal(ordinary.origin.width, 300)
  assert.equal(ordinary.origin.height, 48)
  const missing = sheetHarness({ show: true, anchor: '#missing', variant: 'dock' }, null).sheet.data.command
  assert.equal(missing.dock, false)
  assert.equal(missing.anchored, false)
  assert.equal(missing.origin.top, missing.panel.top + missing.panel.height)
})

test('show=false retains the mounted panel until its automatic physical exit completes', () => {
  const h = sheetHarness({ show: true })
  const id = h.sheet.data.command.id
  h.update({ show: false })
  assert.equal(h.sheet.data.rendered, true)
  assert.equal(h.sheet.data.command.close, true)
  h.sheet.finishClose({ id })
  assert.equal(h.sheet.data.rendered, false)
  assert.equal(h.timers.size, 0)
  assert.equal(h.events.length, 0, 'programmatic closure must not re-toggle the parent')
})

test('a missing native completion still releases the hit layer within one finite timeout', () => {
  const h = sheetHarness({ show: true })
  h.sheet.requestClose()
  h.sheet.requestClose()
  assert.equal(h.timers.size, 1)
  h.flush()
  assert.equal(h.sheet.data.rendered, false)
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].completed, true)
})

test('business closure during a user exit never reopens a toggle-based picker', () => {
  const h = sheetHarness({ show: true })
  h.sheet.requestClose()
  const id = h.sheet.data.command.id
  h.update({ show: false })
  h.sheet.finishClose({ id })
  assert.equal(h.events.length, 0)
  assert.equal(h.sheet.data.rendered, false)
})

test('reopening reverses the current trajectory and rejects the former close completion', () => {
  const h = sheetHarness({ show: true })
  h.update({ show: false })
  const oldId = h.sheet.data.command.id
  h.update({ show: true })
  assert.notEqual(h.sheet.data.command.id, oldId)
  assert.equal(h.sheet.data.command.resume, true)
  assert.equal(h.sheet.data.command.close, false)
  h.sheet.finishClose({ id: oldId })
  h.flush()
  assert.equal(h.sheet.data.rendered, true)
  assert.equal(h.events.length, 0)
})

test('hide and restore cancel the deadline and invalidate delayed bridge messages', () => {
  const h = sheetHarness({ show: true })
  const oldId = h.sheet.data.command.id
  h.sheet.requestClose()
  h.definition.pageLifetimes.hide.call(h.sheet)
  assert.equal(h.timers.size, 0)
  h.definition.pageLifetimes.show.call(h.sheet)
  h.sheet.dismissFromGesture({ id: oldId })
  assert.equal(h.sheet.data.rendered, true)
  h.sheet.dismissFromGesture({ id: h.sheet.data.command.id })
  assert.equal(h.sheet.data.rendered, false)
  assert.equal(h.events.length, 1)
})

test('saving guards both mask requests and late drag completions', () => {
  const h = sheetHarness({ show: true, dismissible: false })
  h.sheet.requestClose()
  h.sheet.dismissFromGesture({ id: h.sheet.data.command.id })
  h.flush()
  assert.equal(h.sheet.data.rendered, true)
  assert.equal(h.events.length, 0)
})

test('detaching clears a pending exit without issuing state updates or business events', () => {
  const h = sheetHarness({ show: true })
  h.sheet.requestClose()
  h.definition.lifetimes.detached.call(h.sheet)
  assert.equal(h.timers.size, 0)
  h.sheet.setData = () => assert.fail('detached component received an update')
  h.sheet.finishClose({ id: 1 })
  assert.equal(h.events.length, 0)
})

test('resizing during dismissal completes the active close instead of stranding a stale timeout', () => {
  const h = sheetHarness({ show: true })
  h.sheet.requestClose()
  h.definition.pageLifetimes.resize.call(h.sheet)
  h.flush()
  assert.equal(h.sheet.data.rendered, false)
  assert.equal(h.timers.size, 0)
  assert.equal(h.events.length, 1)
})

test('reopening while a fresh measurement is pending restarts measurement rather than resuming an inactive command', () => {
  const h = sheetHarness({ show: true })
  h.update({ show: false }); h.flush()
  const queries = []
  h.sheet.createSelectorQuery = () => ({ select() { return this }, boundingClientRect() { return this }, exec(callback) { queries.push(callback) } })
  h.update({ show: true })
  h.update({ show: false })
  h.update({ show: true })
  assert.equal(queries.length, 2)
  queries[0]([{ left: 0, top: 420, width: 390, height: 360 }])
  assert.equal(h.sheet.data.measuring, true, 'outdated measurement is ignored')
  queries[1]([{ left: 0, top: 420, width: 390, height: 360 }])
  h.flush()
  assert.equal(h.sheet.data.measuring, false)
  assert.equal(h.sheet.data.command.active, true)
  assert.equal(h.sheet.data.command.close, false)
})

test('enabling a save lock withdraws a pending user dismissal and rejects its old completion', () => {
  const h = sheetHarness({ show: true })
  h.sheet.requestClose()
  const oldId = h.sheet.data.command.id
  h.sheet.properties.dismissible = false
  h.definition.observers.dismissible.call(h.sheet, false)
  h.sheet.finishClose({ id: oldId })
  h.flush()
  assert.equal(h.sheet.data.rendered, true)
  assert.equal(h.sheet.data.command.resetDrag, true)
  assert.equal(h.events.length, 0)
  h.update({ show: false }); h.flush()
  assert.equal(h.sheet.data.rendered, false, 'the save lock does not override business closure')
})

test('a save lock restores the panel when a finished gesture is still waiting on the bridge', () => {
  const h = sheetHarness({ show: true, contentMotion: 'fade' })
  const view = runtime('components/motion-sheet/sheet-motion.wxs')
  const command = h.sheet.data.command
  view.motion.sync(command, null, view.owner); view.flush()
  view.motion.start(view.event(100, 500), view.owner)
  for (let i = 0; i < 10; i++) {
    view.tick(); view.motion.move(view.event(100, 500 + i * 30), view.owner)
  }
  view.motion.end(view.event(null, null, 'touchend'), view.owner); view.flush()
  const pending = view.calls.find(call => call.name === 'dismissFromGesture')
  assert.ok(pending, 'the dismissal finishes in the render layer before bridge delivery')
  assert.equal(view.state.dismissed, true)
  assert.equal(view.node('.motion-sheet-body').style.opacity, 0)

  h.sheet.properties.dismissible = false
  h.definition.observers.dismissible.call(h.sheet, false)
  const recovery = h.sheet.data.command
  view.motion.sync(recovery, command, view.owner)
  view.tick(); view.tick()
  h.sheet.properties.dismissible = true
  h.definition.observers.dismissible.call(h.sheet, true)
  view.motion.sync(h.sheet.data.command, recovery, view.owner)
  h.sheet.dismissFromGesture(pending.detail)
  view.flush(); h.flush()

  assert.equal(h.sheet.data.rendered, true)
  assert.equal(h.events.length, 0)
  assert.equal(view.state.dismissed, false)
  assert.equal(view.state.y, 0)
  assert.equal(view.node('.motion-sheet-body').style.opacity, 1)
  assert.equal(view.node('.motion-sheet-mask').style.opacity, 1)
  assert.equal(view.node('.motion-sheet-shell').style.transform, 'none')
  assert.equal(view.frames.length, 0)
  assert.equal(h.timers.size, 0)
})

test('a fast save completion continues restoring a drawer from its middle anchor', () => {
  const h = sheetHarness({ show: true, contentMotion: 'fade' })
  const view = runtime('components/motion-sheet/sheet-motion.wxs')
  const command = h.sheet.data.command
  view.motion.sync(command, null, view.owner); view.flush()
  view.motion.start(view.event(100, 500), view.owner)
  view.tick(); view.motion.move(view.event(100, 600), view.owner); view.tick(140)
  view.motion.end(view.event(null, null, 'touchend'), view.owner); view.flush()
  assert.ok(view.state.y > 90 && view.state.y < 110, 'the drawer rests at its middle anchor')

  h.sheet.properties.dismissible = false
  h.definition.observers.dismissible.call(h.sheet, false)
  const recovery = h.sheet.data.command
  view.motion.sync(recovery, command, view.owner); view.tick(); view.tick()
  h.sheet.properties.dismissible = true
  h.definition.observers.dismissible.call(h.sheet, true)
  view.motion.sync(h.sheet.data.command, recovery, view.owner); view.flush()
  assert.equal(view.state.y, 0)
  assert.equal(view.node('.motion-sheet-body').style.opacity, 1)
  assert.equal(h.events.length, 0)

  h.update({ show: false })
  assert.equal(h.sheet.data.command.resetDrag, false, 'business closure retires recovery intent')
  view.motion.sync(h.sheet.data.command, recovery, view.owner); view.flush(); h.flush()
  assert.equal(h.sheet.data.rendered, false)
})

const diagnosisFlow = require('../subpackages/study/wrong-detail/utils/wrong-detail-diagnosis-flow')
const removeFlow = require('../subpackages/study/wrong-detail/utils/wrong-detail-remove-flow')
for (const scenario of [
  { name: 'diagnosis', visible: 'diagnosisSheetVisible', lock: 'diagnosisSaving',
    submit: diagnosisFlow.saveDiagnosis, close: diagnosisFlow.closeDiagnosisSheet, method: 'put' },
  { name: 'remove confirmation', visible: 'removeConfirmVisible', lock: 'removeSubmitting',
    submit: removeFlow.removeFromWrongBook, close: removeFlow.closeRemoveConfirm, method: 'post' },
]) {
  test(`wrong-detail ${scenario.name} stays open through a failed request and can retry`, async t => {
    t.mock.method(console, 'error', () => {})
    const template = fs.readFileSync(path.join(__dirname, '../subpackages/study/wrong-detail/wrong-detail.wxml'), 'utf8')
    const tag = template.match(new RegExp('<motion-sheet\\b[^>]*show="\\{\\{' + scenario.visible + '\\}\\}"[^>]*>'))
    assert.ok(tag, 'exercise the actual migrated sheet')
    const binding = tag[0].match(/dismissible="\{\{!(\w+)\}\}"/)
    const h = sheetHarness({ show: true })
    const page = {
      _alive: true, _currentWqId: 12, _clearMasterUndo() {},
      data: { [scenario.visible]: true, [scenario.lock]: false,
        wq: { id: 12 }, diagnosisPrimary: 'knowledge_gap', diagnosisSecondaryMap: {} },
      setData(patch) {
        Object.assign(this.data, patch)
        const dismissible = binding ? !this.data[binding[1]] : true
        h.sheet.properties.show = this.data[scenario.visible]
        if (dismissible !== h.sheet.properties.dismissible) {
          h.sheet.properties.dismissible = dismissible
          h.definition.observers.dismissible.call(h.sheet, dismissible)
        }
        h.sheet.syncVisibility()
      },
    }
    const trigger = h.sheet.triggerEvent
    h.sheet.triggerEvent = function (name, detail) {
      trigger.call(this, name, detail)
      if (name === 'close') scenario.close(page)
    }
    let rejectRequest, requests = 0
    const ports = {
      requestClient: {
        [scenario.method]() { requests++; return new Promise((resolve, reject) => { rejectRequest = reject }) },
        getErrorMessage: error => error.message,
      },
      platform: { showToast() {} },
    }
    const request = scenario.submit(page, ports)
    assert.equal(page.data[scenario.lock], true)
    scenario.close(page)
    h.sheet.requestClose(); h.flush()
    assert.equal(page.data[scenario.visible], true, 'the business close guard remains authoritative')
    assert.equal(h.sheet.data.rendered, true, 'mask dismissal cannot hide a locked form')
    rejectRequest(new Error('temporary failure')); await request
    assert.equal(page.data[scenario.lock], false)
    assert.equal(h.sheet.data.rendered, true, 'failed requests keep the retry UI visible')

    const retry = scenario.submit(page, ports)
    assert.equal(requests, 2, 'the real submit flow can retry after failure')
    h.sheet.requestClose(); h.flush()
    assert.equal(h.sheet.data.rendered, true)
    rejectRequest(new Error('temporary failure')); await retry
    h.sheet.requestClose(); h.flush()
    assert.equal(h.sheet.data.rendered, false)
    assert.equal(page.data[scenario.visible], false)
    assert.equal(h.events.length, 1, 'an unlocked cancellation completes once')
  })
}

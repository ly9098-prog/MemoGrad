const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

function load(file, globals) {
  const context = { module: { exports: {} }, ...globals }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file })
  return context.module.exports
}

test('shared navigation captures geometry once, guards delayed measurement, and falls back to native navigation', () => {
  const navigations = []
  let measure
  const wx = {
    navigateTo(options) { navigations.push(options) },
    createSelectorQuery() {
      return { in() { return this }, select() { return this },
        boundingClientRect(callback) { measure = callback; return this }, exec() {} }
    },
  }
  const api = load('utils/shared-card-navigation.js', { wx })
  const page = {}
  const event = { currentTarget: { id: 'card-12' } }
  api.open(page, event, '/pages/detail/index', '公式')
  api.open(page, event, '/pages/detail/index', '公式')
  assert.equal(navigations.length, 0)
  measure({ left: 12, top: 160, width: 300, height: 120 })
  assert.equal(navigations.length, 1)
  const key = navigations[0].url.split('_motion=')[1]
  assert.ok(key)
  assert.equal(navigations[0].animationDuration, 0)
  assert.equal(api.take(key).title, '公式')
  assert.equal(api.take(key), null, 'geometry cannot leak into another navigation')
  navigations[0].complete()

  let valid = true
  api.open(page, event, '/pages/detail/index?id=12', '公式', () => valid)
  valid = false
  measure({ width: 300, height: 120 })
  assert.equal(navigations.length, 1, 'changed session suppresses a late navigation')
  assert.equal(page._sharedCardOpening, false)

  api.open(page, event, '/pages/detail/index?id=12', '公式')
  page._visible = false
  measure({ width: 300, height: 120 })
  assert.equal(navigations.length, 1, 'hidden page cannot issue a late navigation')
  page._visible = true
  api.open(page, event, '/pages/detail/index?id=12', '公式')
  measure({ width: 0, height: 120 })
  assert.equal(navigations[1].url, '/pages/detail/index?id=12')
  assert.equal(navigations[1].animationType, 'slide-in-right')
  navigations[1].complete()
  api.open(page, {}, '/pages/detail/index', '')
  assert.equal(navigations[2].animationDuration, 300)
})

test('shared transition reveals existing loading UI, has finite fallbacks, and cancels stale return geometry on resize', () => {
  const timers = new Map()
  let serial = 0, definition
  load('components/shared-card-transition/index.js', {
    require: () => ({ take: () => ({ title: '题面', rect: { left: 12, top: 80, width: 300, height: 160 } }) }),
    Component: value => { definition = value },
    wx: { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }) },
    setTimeout: callback => { timers.set(++serial, callback); return serial },
    clearTimeout: id => { timers.delete(id) },
  })
  const component = { ...definition.methods, data: { ...definition.data },
    properties: { transitionKey: 'card-1' },
    setData(patch) { Object.assign(this.data, patch) } }
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
  definition.lifetimes.attached.call(component)
  flush()
  assert.equal(component._arrived, true)
  flush()
  assert.equal(component.data.visible, false, 'slow content reveals the original loading UI; no blank blocking surface')
  let departed = 0, cancelled = 0
  assert.equal(component.leave(() => departed++, () => cancelled++), true)
  definition.pageLifetimes.resize.call(component)
  flush()
  assert.equal(departed, 0)
  assert.equal(cancelled, 1, 'cancelled return releases the page navigation guard')
  assert.equal(component.leave(() => departed++), false)
  assert.equal(component.data.visible, false)

  component.start('card-2')
  assert.equal(component.leave(() => departed++), true)
  flush()
  component.departed()
  assert.equal(departed, 1, 'native completion and fallback cannot navigate twice')
  definition.lifetimes.detached.call(component)
  assert.equal(timers.size, 0)
})

test('native return animation remains available when there is no shared element', () => {
  const api = load('utils/shared-card-navigation.js', {})
  const values = []
  api.back({}, value => values.push(value))
  api.back({ selectComponent: () => ({ leave: callback => { callback(); return true } }) }, value => values.push(value))
  assert.deepEqual(values, [false, true])
})

test('failed shared return cancels the completed surface and restores the reader', () => {
  let definition
  const timers = new Map()
  let serial = 0, releases = 0, retry
  load('components/shared-card-transition/index.js', {
    require: () => ({ take: () => ({ title: '公式', rect: { left: 12, top: 80, width: 300, height: 160 } }) }),
    Component: value => { definition = value },
    wx: { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }) },
    setTimeout: callback => { timers.set(++serial, callback); return serial },
    clearTimeout: id => timers.delete(id),
  })
  const component = { ...definition.methods, data: { ...definition.data },
    properties: { transitionKey: 'card-1' },
    setData(patch) { Object.assign(this.data, patch) } }
  definition.lifetimes.attached.call(component)
  const api = load('utils/shared-card-navigation.js', {})
  api.back({ selectComponent: () => component }, (morphed, onFailure) => {
    assert.equal(morphed, true)
    retry = onFailure
  }, () => releases++)
  component.departed()
  assert.equal(component.data.visible, true)
  assert.equal(typeof retry, 'function', 'navigation failure must have a surface rollback')
  retry()
  assert.equal(component.data.visible, false)
  assert.equal(component.data.command.active, false)
  assert.equal(timers.size, 0)
  assert.equal(releases, 1, 'failure releases the navigation guard once')
  assert.equal(component.leave(() => {}), false, 'failed geometry is discarded before a native retry')
})

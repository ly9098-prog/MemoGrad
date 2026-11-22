const assert = require('node:assert/strict')
const { test, afterEach } = require('node:test')
const gate = require('../utils/digit-reveal-gate')
const numbers = require('../utils/number-reveal')
const { commitDuration } = require('../subpackages/productivity/pomodoro-stats/duration-reveal')

const originalWx = global.wx
const pages = []
afterEach(() => {
  pages.forEach(page => { numbers.clear(page); gate.clear(page) })
  pages.length = 0
  if (originalWx === undefined) delete global.wx
  else global.wx = originalWx
})

function fixture() {
  const frames = [], commits = [], observers = []
  global.wx = { nextTick: callback => frames.push(callback) }
  const page = {
    _alive: true, _visible: true, data: {},
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) commits.push(callback)
    },
    createIntersectionObserver(options) {
      const observer = {
        options,
        disconnected: false,
        relativeToViewport() { return this },
        observe(selector, callback) { this.selector = selector; this.notify = callback },
        disconnect() { this.disconnected = true },
      }
      observers.push(observer)
      return observer
    },
  }
  pages.push(page)
  const flush = queue => { while (queue.length) queue.shift()() }
  return { page, observers, commits, frames,
    commit: () => flush(commits), frame: () => flush(frames),
    enter: (observer = observers.at(-1)) => observer.notify({ intersectionRatio: 0.5 }),
  }
}
const fields = [{ name: 'count', segmentsKey: 'digits' }]
function start(page, target) {
  return numbers.start(page, { fields, to: { count: target }, selector: '.metrics' })
}

test('page and platform observers use native viewport observation and retain the entrance gate', () => {
  for (const platformFallback of [false, true]) {
    const h = fixture()
    if (platformFallback) {
      const create = h.page.createIntersectionObserver.bind(h.page)
      delete h.page.createIntersectionObserver
      global.wx.createIntersectionObserver = (page, options) => {
        assert.equal(page, h.page)
        return create(options)
      }
    }
    gate.resume(h.page, true)
    let started = 0
    gate.arm(h.page, 'native', '.metric', () => { started++ })
    h.frame()
    assert.deepEqual(h.observers[0].options, { thresholds: [0], initialRatio: 0, nativeMode: true })
    h.observers[0].notify({ intersectionRatio: 0 })
    assert.equal(started, 0)
    h.enter()
    assert.equal(started, 1)
    assert.equal(h.observers[0].disconnected, true)
  }
})

test('slow first render waits for commit, ready, next tick and viewport before starting its clock', () => {
  const h = fixture()
  start(h.page, 42)
  assert.equal(h.page._numberRevealState.startTime, null)
  assert.equal(h.page.data.digitsPlaying, false)
  h.frame()
  assert.equal(h.observers.length, 0)
  h.commit()
  assert.equal(h.observers.length, 0)
  gate.resume(h.page, true)
  assert.equal(h.observers.length, 0)
  h.frame()
  h.observers[0].notify({ intersectionRatio: 0 })
  assert.equal(h.page._numberRevealState.startTime, null)
  h.enter()
  // Clock must also wait for the view's running-class commit.
  assert.equal(h.page._numberRevealState.startTime, null)
  h.commit()
  assert.equal(typeof h.page._numberRevealState.startTime, 'number')
  assert.ok(h.page._numberRevealTimer)
})

test('data arriving after onReady still starts only after its own rendered commit', () => {
  const h = fixture()
  gate.resume(h.page, true)
  h.frame()
  assert.equal(h.observers.length, 0)
  start(h.page, 9)
  h.frame()
  assert.equal(h.observers.length, 0)
  h.commit(); h.frame(); h.enter(); h.commit()
  assert.equal(h.page.data.digitsPlaying, true)
})

test('an identical response during count-up retains the existing entrance and clock', () => {
  const h = fixture()
  gate.resume(h.page, true)
  start(h.page, 42)
  h.commit(); h.frame(); h.enter(); h.commit()
  const state = h.page._numberRevealState
  const timer = h.page._numberRevealTimer
  assert.equal(start(h.page, 42), false)
  assert.equal(h.page._numberRevealState, state)
  assert.equal(h.page._numberRevealTimer, timer)
  assert.equal(h.page.data.digitsPlaying, true)
})

test('hidden pending entrance survives until page returns; obsolete observer cannot release it', () => {
  const h = fixture()
  gate.resume(h.page, true)
  start(h.page, 9)
  h.commit(); h.frame()
  const previous = h.observers[0]
  h.page._visible = false
  gate.suspend(h.page)
  numbers.finish(h.page)
  assert.equal(h.page.data.count, 9)
  h.page._visible = true
  gate.resume(h.page)
  h.frame()
  h.enter(previous)
  assert.equal(h.page.data.digitsPlaying, false)
  h.enter(); h.commit()
  assert.equal(h.page.data.digitsPlaying, true)
})

test('rapid replacement and unload reject queued render callbacks and viewport callbacks', () => {
  const h = fixture()
  gate.resume(h.page, true)
  start(h.page, 7)
  start(h.page, 8)
  h.commit(); h.frame()
  assert.equal(h.observers.length, 1)
  const state = h.page._numberRevealState
  assert.equal(state.to.count, 8)
  h.page._alive = false
  numbers.clear(h.page); gate.clear(h.page)
  h.enter(); h.commit()
  assert.equal(h.page.data.digitsPlaying, false)
  assert.equal(h.page._numberRevealTimer, null)
})

test('a superseded count-up frame cannot overwrite the current digits or animation state', () => {
  const h = fixture()
  start(h.page, 7)
  const obsolete = h.page._numberRevealState
  obsolete.startTime = Date.now() - 1000
  start(h.page, 9)
  const current = h.page._numberRevealState
  numbers.tick(h.page, obsolete)
  assert.equal(h.page._numberRevealState, current)
  assert.equal(h.page.data.count, 0)
  numbers.finish(h.page)
  assert.equal(h.page.data.count, 9)
  assert.equal(h.page.data.digits.map(item => item.text).join(''), '9')
})

test('a zero count keeps its entrance pending even though its value does not change', () => {
  const h = fixture()
  h.page.data.count = 0
  gate.resume(h.page, true)
  assert.equal(start(h.page, 0), true)
  h.commit(); h.frame()
  assert.equal(h.page.data.digits[0].text, '0')
  assert.equal(h.page.data.digitsPlaying, false)
  h.enter(); h.commit()
  assert.equal(h.page.data.digitsPlaying, true)
})

function durationPatch(text) {
  return { _dispTodayDurationText: text,
    _dispTodayDurationSegments: [{ text, type: 'num', direction: 'top' }] }
}

test('duration final value is available immediately but the CSS entrance waits for viewport', () => {
  const h = fixture()
  gate.resume(h.page, true)
  commitDuration(h.page, durationPatch('25'))
  assert.equal(h.page.data._dispTodayDurationText, '25')
  assert.equal(h.page.data._durationRevealPlaying, false)
  h.commit(); h.frame()
  assert.equal(h.page.data._durationRevealPlaying, false)
  h.enter()
  assert.equal(h.page.data._durationRevealPlaying, true)
})

test('same-date duration refresh preserves pending and completed entrances', () => {
  const h = fixture()
  gate.resume(h.page, true)
  h.page.data.selectedDate = '2026-11-20'
  commitDuration(h.page, durationPatch('25'))
  h.commit(); h.frame()
  const observer = h.observers[0]
  commitDuration(h.page, { ...durationPatch('25'), _dispTodaySessions: 3 })
  h.commit(); h.frame()
  assert.equal(h.observers.length, 1, 'identical data cannot replace the pending viewport observer')
  assert.equal(observer.disconnected, false)
  h.enter(observer)
  assert.equal(h.page.data._durationRevealPlaying, true)
  commitDuration(h.page, durationPatch('25'))
  h.commit(); h.frame()
  assert.equal(h.page.data._durationRevealPlaying, true, 'refresh cannot rewind a completed entrance')
  assert.equal(h.observers.length, 1)
  h.page.data.selectedDate = '2026-11-19'
  commitDuration(h.page, durationPatch('25'))
  assert.equal(h.page.data._durationRevealPlaying, false, 'a selected date change still owes a new entrance')
})

test('the ordinary load commit preserves duration directions before an identical animated refresh', () => {
  const flow = require('../subpackages/productivity/pomodoro-stats/stats-load-view-flow')
  const formatter = require('../subpackages/productivity/pomodoro-stats/duration-formatter')
  const h = fixture()
  h.page._buildDurationSegments = formatter.buildDurationSegments
  h.page.data.selectedDate = '2026-11-20'
  gate.resume(h.page, true)
  const display = flow._getTodayDurationDisplayPatch(h.page, '25分钟', { reveal: true })
  commitDuration(h.page, display)
  h.commit(); h.frame(); h.enter()
  const revision = h.page._durationRevealRevision
  // load-view-state publishes an ordinary patch before the animation controller.
  const refresh = flow._getTodayDurationDisplayPatch(h.page, '25分钟')
  h.page.setData(refresh)
  assert.deepEqual(refresh._dispTodayDurationSegments, display._dispTodayDurationSegments,
    'removing and re-adding direction classes would restart CSS despite stable keys')
  assert.equal(h.page._durationRevealRevision, revision)
  commitDuration(h.page, flow._getTodayDurationDisplayPatch(h.page, '25分钟', { reveal: true }))
  h.commit(); h.frame()
  assert.equal(h.page.data._durationRevealPlaying, true)
  assert.equal(h.observers.length, 1)
})

test('superseding the rendered duration invalidates its pending entrance', () => {
  const flow = require('../subpackages/productivity/pomodoro-stats/stats-load-view-flow')
  const formatter = require('../subpackages/productivity/pomodoro-stats/duration-formatter')
  const h = fixture()
  h.page._buildDurationSegments = formatter.buildDurationSegments
  gate.resume(h.page, true)
  commitDuration(h.page, flow._getTodayDurationDisplayPatch(h.page, '25分钟', { reveal: true }))
  h.commit(); h.frame()
  h.page.setData(flow._getTodayDurationDisplayPatch(h.page, '30分钟'))
  h.enter()
  assert.equal(h.page.data._dispTodayDurationText, '30分钟')
  assert.equal(h.page.data._durationRevealPlaying, false)
})

test('a newer duration render wins when setData callbacks return out of order', () => {
  const h = fixture()
  gate.resume(h.page, true)
  h.page._durationRevealRevision = 1
  commitDuration(h.page, durationPatch('25'))
  h.page._durationRevealRevision = 2
  commitDuration(h.page, durationPatch('30'))
  h.commits.reverse(); h.commit(); h.frame()
  assert.equal(h.observers.length, 1)
  h.enter()
  assert.equal(h.page.data._dispTodayDurationText, '30')
  assert.equal(h.page.data._durationRevealPlaying, true)
})

test('hiding before nextTick invalidates that frame and avoids observing the hidden page', () => {
  const h = fixture()
  gate.resume(h.page, true)
  let count = 0
  gate.arm(h.page, 'test', '.test', () => { count += 1 })
  h.page._visible = false; gate.suspend(h.page)
  h.page._visible = true; gate.resume(h.page)
  h.frame()
  assert.equal(h.observers.length, 1)
  h.enter()
  assert.equal(count, 1)
})


test('each metric owns its viewport entrance, including values below the fold after count-up finishes', () => {
  const h = fixture()
  gate.resume(h.page, true)
  numbers.start(h.page, {
    fields: [{ name: 'top', segmentsKey: 'topDigits', selector: '.top' },
      { name: 'bottom', segmentsKey: 'bottomDigits', selector: '.bottom' }],
    to: { top: 5, bottom: 10 },
  })
  h.commit(); h.frame()
  assert.deepEqual(h.observers.map(item => item.selector), ['.top', '.bottom'])
  h.enter(h.observers[0]); h.commit()
  assert.equal(h.page.data.topDigitsPlaying, true)
  assert.equal(h.page.data.bottomDigitsPlaying, false)
  numbers.finish(h.page)
  assert.equal(h.page.data.bottom, 10)
  // A background refresh returning the same values cannot discard this job.
  assert.equal(numbers.start(h.page, { fields: h.page._numberRevealFields, to: { top: 5, bottom: 10 } }), false)
  h.enter(h.observers[1]); h.commit()
  assert.equal(h.page.data.bottomDigitsPlaying, true)
})

test('a dashboard render callback from an older request cannot start stale numbers', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
  let page
  const filename = path.join(__dirname, '../pages/dashboard/dashboard.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: definition => { page = definition },
    require: name => require(path.resolve(path.dirname(filename), name)),
  })
  const callbacks = [], starts = []
  Object.assign(page, {
    _alive: true, _visible: true, _dashboardSeq: 1,
    setData(_patch, callback) { callbacks.push(callback) },
    _startNumberReveal(models) { starts.push(models.hero.todayQuestions) },
    _afterDashboardCommit() {},
  })
  page._commitDashboard({ hero: { todayQuestions: 3 } }, 'initial', false)
  page._dashboardSeq = 2
  page._commitDashboard({ hero: { todayQuestions: 9 } }, 'refresh', false)
  callbacks[1](); callbacks[0]()
  assert.deepEqual(starts, [9])
})

test('stats hide/show preserves rendered duration while the new refresh is delayed', () => {
  const { createLifecycleController } = require('../subpackages/productivity/pomodoro-stats/lifecycle-controller')
  const adapter = require('../subpackages/productivity/pomodoro-stats/stats-lifecycle-page-adapter')
  const h = fixture()
  let requests = 0
  Object.assign(h.page, {
    _isVisible: true, _requestId: 0, _viewReady: false,
    _syncThemeFromStorage() {}, loadData() { requests += 1 },
    _scheduleDynamicRefresh() {}, _clearDynamicRefresh() {},
    _cancelDurationAnimation() {}, _cancelDeferredHistory() {}, _initCanvases() {},
  })
  const lifecycle = adapter._getLifecycleController(h.page, {
    createLifecycleController, digitRevealGate: gate,
    getPlatform: () => global.wx, getSetTimeout: () => setTimeout,
  })
  lifecycle.ready()
  commitDuration(h.page, durationPatch('25'))
  h.commit(); h.frame()
  lifecycle.hide(); lifecycle.show()
  assert.equal(requests, 2)
  h.frame(); h.enter()
  assert.equal(h.page.data._dispTodayDurationText, '25')
  assert.equal(h.page.data._durationRevealPlaying, true)
})

test('an inactive report panel retains its entrance until the summary becomes visible', () => {
  const h = fixture()
  let mode = 'budget'
  gate.resume(h.page, true)
  numbers.start(h.page, { fields, to: { count: 8 }, canStart: () => mode === 'summary' })
  h.commit(); h.frame(); h.enter(); h.commit()
  assert.equal(h.page.data.digitsPlaying, false)
  assert.equal(h.page._numberRevealState.startTime, null)
  mode = 'summary'
  gate.suspend(h.page); gate.resume(h.page)
  h.frame(); h.enter(); h.commit()
  assert.equal(h.page.data.digitsPlaying, true)
})

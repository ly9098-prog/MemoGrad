const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createDurationAnimationController,
} = require('../subpackages/productivity/pomodoro-stats/duration-animation-controller')

function createHarness(overrides = {}) {
  const state = {
    alive: true,
    visible: true,
    token: 0,
    timer: null,
    timeoutSeq: 0,
    displayDurationSec: null,
    displaySessions: 0,
    data: [],
    timers: [],
  }
  const options = {
    isAlive: () => state.alive,
    isVisible: () => state.visible,
    getToken: () => state.token,
    incrementToken: () => { state.token += 1 },
    getTimer: () => state.timer,
    setTimer: timer => { state.timer = timer },
    clearTimeout: timer => { state.timers.push(['clear', timer]) },
    setTimeout: (callback, delay) => {
      const handle = { callback, delay, seq: ++state.timeoutSeq }
      state.timers.push(['set', handle])
      state.timer = handle
      return handle
    },
    getDisplaySessions: () => state.displaySessions,
    setDisplayDurationSec: value => { state.displayDurationSec = value },
    getDurationDisplayPatch: (text, { reveal = false } = {}) => ({
      _dispTodayDurationText: text,
      _dispTodayDurationSegments: reveal ? [{ type: 'num', text, reveal: true }] : [{ type: 'num', text }],
    }),
    setData: patch => { state.data.push(patch) },
    ...overrides,
  }
  return { controller: createDurationAnimationController(options), options, state }
}

test('cancel clears any pending legacy timer and resets the session view state', () => {
  const h = createHarness()
  const pending = { callback() {} }
  h.state.timer = pending
  h.controller.cancel(true)
  assert.equal(h.state.token, 1)
  assert.ok(h.state.timers.some(entry => entry[0] === 'clear' && entry[1] === pending))
  assert.equal(h.state.timer, null)
  assert.deepEqual(h.state.data, [{ durationValueAnimating: false }])
})

test('duration publishes the final value once with digit reveal and no count-up timer', () => {
  const h = createHarness()
  h.controller.animate(0, 1200, 1, 3)
  assert.equal(h.state.displayDurationSec, 1200)
  assert.deepEqual(h.state.data, [{
    _dispTodaySessions: 3,
    _dispTodayDurationText: '20分钟',
    _dispTodayDurationSegments: [{ type: 'num', text: '20分钟', reveal: true }],
    durationValueAnimating: false,
  }])
  assert.equal(h.state.timer, null)
  assert.deepEqual(h.state.timers, [])
})

test('successive dates never emit intermediate durations', () => {
  const h = createHarness()
  h.controller.animate(0, 7200, 0, 4)
  h.controller.animate(7200, 60, 4, 1)
  assert.deepEqual(h.state.data.map(patch => patch._dispTodayDurationText), ['2时0分', '1分钟'])
  assert.equal(h.state.displayDurationSec, 60)
  assert.equal(h.state.timer, null)
})

test('hidden or dead pages do not publish a digit entrance', () => {
  for (const key of ['visible', 'alive']) {
    const h = createHarness()
    h.state[key] = false
    h.controller.animate(0, 600, 0, 1)
    assert.deepEqual(h.state.data, [])
    assert.equal(h.state.timer, null)
  }
})

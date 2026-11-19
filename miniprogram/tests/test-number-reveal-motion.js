const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const numberReveal = require('../utils/number-reveal')
const miniRoot = path.resolve(__dirname, '..')

test('number reveal builds alternating digit segments with deterministic keys', () => {
  const segments = numberReveal.buildNumberSegments(1234)
  assert.deepEqual(segments.map(item => item.text), ['1', '2', '3', '4'])
  assert.deepEqual(segments.map(item => item.direction), ['top', 'bottom', 'top', 'bottom'])
  assert.deepEqual(segments.map(item => item.delay), [0, 38, 76, 114])
  assert.equal(new Set(segments.map(item => item.key)).size, 4)
})

test('number reveal clamps percentages and normalizes invalid counts', () => {
  assert.deepEqual(numberReveal.buildPercentSegments(150).map(item => item.text), ['1', '0', '0'])
  assert.deepEqual(numberReveal.buildPercentSegments(-2).map(item => item.text), ['0'])
  assert.deepEqual(numberReveal.buildNumberSegments('bad').map(item => item.text), ['0'])
})

test('count-up changes glyphs without replacing digit nodes', () => {
  assert.deepEqual(
    numberReveal.buildNumberSegments(12).map(item => item.key),
    numberReveal.buildNumberSegments(98).map(item => item.key),
    'wx:key identifies the digit position, never an intermediate count-up value'
  )
})

test('pending digits remain readable and only a released gate installs their shared entrance', () => {
  const shared = fs.readFileSync(path.join(miniRoot, 'styles/number-reveal.wxss'), 'utf8')
  const defaultRule = shared.match(/\.reveal-digit,\s*\.daily-duration-digit\s*\{([^}]+)\}/)[1]
  assert.match(defaultRule, /opacity:\s*1\s*;/)
  assert.match(defaultRule, /animation:\s*none\s*;/)
  assert.match(defaultRule, /transform:\s*none\s*;/)
  assert.doesNotMatch(shared, /opacity:\s*0\s*;|translate3d|scale\(|will-change|\bboth\s*;/)
  for (const filename of ['pages/home/home.wxss', 'pages/dashboard/dashboard.wxss',
    'subpackages/productivity/pomodoro-stats/index.wxss']) {
    const source = fs.readFileSync(path.join(miniRoot, filename), 'utf8')
    assert.match(source, /@import '[^']*styles\/number-reveal\.wxss'/)
    assert.doesNotMatch(source, /\.(?:reveal-digit|daily-duration-digit)[^{}]*\{[^{}]*\banimation:\s*(?!none\b)\S/,
      `${filename} cannot install another animation on the shared digits`)
    assert.doesNotMatch(source, /animation-play-state:\s*paused/)
  }
})

test('home progress animation never competes with the digit controller for streak', () => {
  const growth = require('../pages/home/utils/growth-animation')
  const patches = []
  const page = { _alive: true, _visible: true, setData: patch => patches.push(patch) }
  growth.tick(page, {
    from: { streakDays: 0, goalDone: 0, levelProgress: 0 },
    to: { streakDays: 7, goalDone: 3, levelProgress: 40 },
    durations: { streakDays: 1, goalDone: 1, levelProgress: 1 },
    startTime: Date.now() - 10,
  })
  assert(patches.length > 0)
  assert(patches.every(patch => !Object.hasOwn(patch, '_animStreakDays')),
    'numberReveal alone owns the scalar value and its displayed digit segments')
  assert.equal(patches.at(-1)._animGoalDone, 3)
})

test('number reveal starts only when values actually change and reaches targets', () => {
  const page = {
    _digitRevealReady: true,
    _alive: true,
    _visible: true,
    data: {
      _animTotalCorrect: 12,
      _animTotalCorrectSegments: numberReveal.buildNumberSegments(12),
      _animConsecutiveDays: 4,
      _animConsecutiveSegments: numberReveal.buildNumberSegments(4),
      _animAccuracy: 68,
      _animAccuracySegments: numberReveal.buildPercentSegments(68),
      _animDueReviewCount: 2,
      _animDueReviewSegments: numberReveal.buildNumberSegments(2),
    },
    patches: [],
    setData(patch, callback) {
      this.patches.push(patch)
      Object.assign(this.data, patch)
      if (callback) callback()
    },
  }
  const fields = [
    { name: '_animTotalCorrect', segmentsKey: '_animTotalCorrectSegments' },
    { name: '_animConsecutiveDays', segmentsKey: '_animConsecutiveSegments' },
    { name: '_animAccuracy', kind: 'percent', segmentsKey: '_animAccuracySegments' },
    { name: '_animDueReviewCount', segmentsKey: '_animDueReviewSegments' },
  ]
  assert.equal(numberReveal.start(page, { fields, to: {
    _animTotalCorrect: 12,
    _animConsecutiveDays: 4,
    _animAccuracy: 68,
    _animDueReviewCount: 2,
  } }), false)

  assert.equal(numberReveal.start(page, { fields, to: {
    _animTotalCorrect: 24,
    _animConsecutiveDays: 6,
    _animAccuracy: 74,
    _animDueReviewCount: 0,
  }, durations: {
    _animTotalCorrect: 80,
    _animConsecutiveDays: 80,
    _animAccuracy: 80,
    _animDueReviewCount: 80,
  } }), true)

  return new Promise((resolve) => {
    setTimeout(() => {
      numberReveal.clear(page)
      assert.equal(page.data._animTotalCorrect, 24)
      assert.equal(page.data._animConsecutiveDays, 6)
      assert.equal(page.data._animAccuracy, 74)
      assert.equal(page.data._animDueReviewCount, 0)
      assert.deepEqual(page.data._animTotalCorrectSegments.map(item => item.text), ['2', '4'])
      assert.deepEqual(page.data._animAccuracySegments.map(item => item.text), ['7', '4'])
      assert.match(fs.readFileSync(path.join(miniRoot, 'pages/dashboard/dashboard.wxml'), 'utf8'), /reveal-digit-\{\{item\.direction\}\}/)
  assert.match(fs.readFileSync(path.join(miniRoot, 'pages/dashboard/dashboard.wxml'), 'utf8'), /今日答题数量/)
  assert.match(fs.readFileSync(path.join(miniRoot, 'pages/dashboard/dashboard.js'), 'utf8'), /_animTodayQuestionsSegments/)
  assert.match(fs.readFileSync(path.join(miniRoot, 'pages/home/home.wxml'), 'utf8'), /animation-delay: \{\{item\.delay\}\}ms/)
      assert.match(fs.readFileSync(path.join(miniRoot, 'pages/home/home.wxml'), 'utf8'), /animation-delay: \{\{item\.delay\}\}ms/)
      resolve()
    }, 220)
  })
})

test('number reveal republishes zero and unchanged displays before animating', () => {
  const page = {
    _digitRevealReady: true,
    _alive: true,
    _visible: true,
    data: {
      _animTodayQuestions: 0,
      _animTodayQuestionsSegments: [],
      _animTotalCorrect: 0,
      _animTotalCorrectSegments: [],
      _animConsecutiveDays: 0,
      _animConsecutiveSegments: [],
      _animAccuracy: 0,
      _animAccuracySegments: [],
      _animDueReviewCount: 0,
      _animDueReviewSegments: [],
    },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  }
  const fields = [
    { name: '_animTodayQuestions', segmentsKey: '_animTodayQuestionsSegments' },
    { name: '_animTotalCorrect', segmentsKey: '_animTotalCorrectSegments' },
    { name: '_animConsecutiveDays', segmentsKey: '_animConsecutiveSegments' },
    { name: '_animAccuracy', kind: 'percent', segmentsKey: '_animAccuracySegments' },
    { name: '_animDueReviewCount', segmentsKey: '_animDueReviewSegments' },
  ]

  assert.equal(numberReveal.start(page, {
    fields,
    to: {
      _animTodayQuestions: 0,
      _animTotalCorrect: 0,
      _animConsecutiveDays: 0,
      _animAccuracy: 0,
      _animDueReviewCount: 0,
    },
  }), true)

  fields.forEach((field) => {
    assert.deepEqual(page.data[field.segmentsKey].map(item => item.text), ['0'])
  })
})

test('number reveal finish commits final values when a page hides mid-animation', () => {
  const page = {
    _digitRevealReady: true,
    _alive: true,
    _visible: true,
    data: {
      _animTotalCorrect: 3,
      _animTotalCorrectSegments: numberReveal.buildNumberSegments(3),
    },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  }
  numberReveal.start(page, {
    fields: [{ name: '_animTotalCorrect', segmentsKey: '_animTotalCorrectSegments' }],
    to: { _animTotalCorrect: 18 },
    durations: { _animTotalCorrect: 5000 },
  })
  assert.equal(numberReveal.finish(page), true)
  assert.equal(page.data._animTotalCorrect, 18)
  assert.deepEqual(page.data._animTotalCorrectSegments.map(item => item.text), ['1', '8'])
  assert.equal(page._numberRevealTimer, null)
})

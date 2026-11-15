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

test('number reveal starts only when values actually change and reaches targets', () => {
  const page = {
    _alive: true,
    _visible: true,
    data: {
      _animTotalCorrect: 12,
      _animConsecutiveDays: 4,
      _animAccuracy: 68,
      _animDueReviewCount: 2,
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

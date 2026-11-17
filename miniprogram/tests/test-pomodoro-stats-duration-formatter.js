const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  formatDuration,
  formatHourMinute,
  formatMin,
  buildDurationSegments,
} = require('../subpackages/productivity/pomodoro-stats/duration-formatter')

test('formatDuration floors to minutes', () => {
  assert.equal(formatDuration(41), '0分钟')
  assert.equal(formatDuration(2460), '41分钟')
  assert.equal(formatDuration(15540), '4时19分')
})

test('formatDuration handles zero and negative', () => {
  assert.equal(formatDuration(0), '0分钟')
  assert.equal(formatDuration(-100), '0分钟')
  assert.equal(formatDuration(null), '0分钟')
})

test('formatHourMinute always uses hour-minute format', () => {
  assert.equal(formatHourMinute(0), '0时0分')
  assert.equal(formatHourMinute(3600), '1时0分')
  assert.equal(formatHourMinute(7260), '2时1分')
})

test('formatMin uses minutes under one hour', () => {
  assert.equal(formatMin(0), '0分钟')
  assert.equal(formatMin(3000), '50分钟')
  assert.equal(formatMin(7260), '2时1分')
})

test('buildDurationSegments splits numbers and units', () => {
  assert.deepEqual(buildDurationSegments('4时19分', true), [
    { type: 'num', text: '4', key: 'pos-0', direction: 'top', delay: 0 },
    { type: 'unit', text: '时', key: 'pos-1' },
    { type: 'num', text: '1', key: 'pos-2', direction: 'bottom', delay: 28 },
    { type: 'num', text: '9', key: 'pos-3', direction: 'top', delay: 56 },
    { type: 'unit', text: '分', key: 'pos-4' },
  ])
})

test('buildDurationSegments handles 小时 unit', () => {
  assert.deepEqual(buildDurationSegments('3小时', true), [
    { type: 'num', text: '3', key: 'pos-0', direction: 'top', delay: 0 },
    { type: 'unit', text: '小时', key: 'pos-1' },
  ])
})

test('buildDurationSegments defaults to 0分钟', () => {
  assert.deepEqual(buildDurationSegments('', true), [
    { type: 'num', text: '0', key: 'pos-0', direction: 'top', delay: 0 },
    { type: 'unit', text: '分钟', key: 'pos-1' },
  ])
})

test('buildDurationSegments returns raw text for non-matching input', () => {
  assert.deepEqual(buildDurationSegments('abc', true), [
    { type: 'num', text: 'abc', key: 'pos-0', direction: 'top', delay: 0 },
  ])
})

test('buildDurationSegments keeps reveal keys stable and alternate vertically', () => {
  const segments = buildDurationSegments('11分', true)
  assert.deepEqual(segments.map(item => item.key), ['pos-0', 'pos-1', 'pos-2'])
  assert.deepEqual(segments.filter(item => item.type === 'num').map(item => item.direction), ['top', 'bottom'])
})

test('buildDurationSegments omits reveal animation while counting', () => {
  assert.deepEqual(buildDurationSegments('4时19分'), [
    { type: 'num', text: '4', key: 'pos-0' },
    { type: 'unit', text: '时', key: 'pos-1' },
    { type: 'num', text: '1', key: 'pos-2' },
    { type: 'num', text: '9', key: 'pos-3' },
    { type: 'unit', text: '分', key: 'pos-4' },
  ])
})

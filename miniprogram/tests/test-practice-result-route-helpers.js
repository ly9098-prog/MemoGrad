const assert = require('node:assert/strict')
const { test } = require('node:test')
const { normalizePracticeReturnRoute, safeDecodeJson } = require('../subpackages/study/practice-result/utils/route-helpers')

test('normalizePracticeReturnRoute: accepts valid knowledge detail route', () => {
  assert.equal(normalizePracticeReturnRoute('/subpackages/knowledge/knowledge-detail/index?id=1'), '/subpackages/knowledge/knowledge-detail/index?id=1')
})

test('normalizePracticeReturnRoute: accepts valid knowledge subject route', () => {
  assert.equal(normalizePracticeReturnRoute('/subpackages/knowledge/knowledge-subject/index'), '/subpackages/knowledge/knowledge-subject/index')
})

test('launch and result validators preserve registered knowledge return targets and reject retired routes', () => {
  const { parseLaunchPreset } = require('../subpackages/study/practice/utils/launch-preset')
  const app = require('../app.json')
  const registered = new Set((app.subpackages || app.subPackages).flatMap(pkg =>
    pkg.pages.map(page => `/${pkg.root}/${page}`)))
  for (const type of ['detail', 'subject']) {
    const route = `/subpackages/knowledge/knowledge-${type}/index`
    assert.ok(registered.has(route), 'return targets must exist in app.json')
    const target = `${route}?id=7&source=practice-result`
    const preset = parseLaunchPreset({ return_to: encodeURIComponent(target) }, decodeURIComponent)
    assert.equal(preset.returnTo, target)
    assert.equal(normalizePracticeReturnRoute(preset.returnTo), target)
    const retired = `/subpackages/study/knowledge-${type}/index?id=7`
    assert.equal(parseLaunchPreset({ return_to: retired }, decodeURIComponent).returnTo, '')
    assert.equal(normalizePracticeReturnRoute(retired), '')
  }
})

test('normalizePracticeReturnRoute: rejects invalid route', () => {
  assert.equal(normalizePracticeReturnRoute('/pages/home/home'), '')
})

test('normalizePracticeReturnRoute: rejects empty', () => {
  assert.equal(normalizePracticeReturnRoute(''), '')
})

test('normalizePracticeReturnRoute: rejects null', () => {
  assert.equal(normalizePracticeReturnRoute(null), '')
})

test('normalizePracticeReturnRoute: truncates long input', () => {
  const long = '/subpackages/knowledge/knowledge-detail/index?' + 'x'.repeat(600)
  const result = normalizePracticeReturnRoute(long)
  assert.ok(result.length <= 512)
})

test('safeDecodeJson: parses valid JSON', () => {
  assert.deepEqual(safeDecodeJson('{"a":1}'), { a: 1 })
})

test('safeDecodeJson: parses URI-encoded JSON', () => {
  assert.deepEqual(safeDecodeJson(encodeURIComponent('{"b":2}')), { b: 2 })
})

test('safeDecodeJson: returns null for non-object', () => {
  assert.equal(safeDecodeJson('"hello"'), null)
})

test('safeDecodeJson: returns null for invalid JSON', () => {
  assert.equal(safeDecodeJson('not json'), null)
})

test('safeDecodeJson: returns null for null', () => {
  assert.equal(safeDecodeJson(null), null)
})

test('safeDecodeJson: returns null for empty', () => {
  assert.equal(safeDecodeJson(''), null)
})

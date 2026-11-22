const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

function fixture(states) {
  let clock = 0, current = true
  const calls = [], timers = []
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/ai-teacher-request.js'), 'utf8'), {
    module, Date: { now: () => clock },
    setTimeout(resolve, delay) { timers.push(delay); clock += delay; resolve() },
  })
  const api = {
    async get(...args) {
      calls.push(['get', ...args])
      const state = states.length > 1 ? states.shift() : states[0]
      if (state instanceof Error) throw state
      return state
    },
    async post(...args) { calls.push(['post', ...args]); return { summary: 'complete' } },
  }
  const options = { timeout: 55000, isCurrent: () => current }
  return { api, calls, timers, options, request: module.exports.requestTeacher,
    cancel() { current = false } }
}
const checking = { status: 'checking', enabled: false, reason: 'checking', retry_after_ms: 2000 }
const available = { status: 'available', enabled: true, reason: '' }
const payload = { question_id: 7, action: 'explain_correct' }

test('cold teacher waits for checking then submits the original action exactly once', async () => {
  const state = fixture([checking, checking, available])
  const result = await state.request(state.api, payload, state.options)
  assert.equal(result.summary, 'complete')
  assert.deepEqual(state.calls.map(call => call[0]), ['get', 'get', 'get', 'post'])
  assert.deepEqual(state.timers, [2000, 2000])
  assert.equal(state.calls[3][2], payload)
  assert.equal(state.calls[3][3].timeout, 55000)
})

test('hard unavailability never invokes the teacher or waits', async () => {
  for (const reason of ['quota', 'configuration', 'unconfigured', 'user_quota', 'transient']) {
    const detail = { status: 'unavailable', enabled: false, reason, message: '服务暂不可用' }
    const state = fixture([detail])
    await assert.rejects(state.request(state.api, payload, state.options), error => error.detail.reason === reason)
    assert.equal(state.calls.filter(call => call[0] === 'post').length, 0)
    assert.equal(state.timers.length, 0)
  }
})

test('page cancellation or an exceeded deadline stops before model submission', async () => {
  const state = fixture([checking])
  await assert.rejects(state.request(state.api, payload, state.options), /检查超时/)
  assert.ok(state.timers.reduce((total, delay) => total + delay, 0) <= 65000)
  assert.equal(state.calls.filter(call => call[0] === 'post').length, 0)
  const cancelled = fixture([checking, available])
  const original = cancelled.api.get
  cancelled.api.get = async (...args) => { const result = await original(...args); cancelled.cancel(); return result }
  await assert.rejects(cancelled.request(cancelled.api, payload, cancelled.options), /已取消/)
  assert.equal(cancelled.calls.length, 1)
})

test('only an explicit checking rejection before generation may resubmit', async () => {
  const state = fixture([available, checking, available])
  let posts = 0
  state.api.post = async () => {
    posts++
    if (posts === 1) throw { statusCode: 503, detail: { code: 'ai_service_unavailable', ...checking } }
    return { summary: 'complete' }
  }
  assert.equal((await state.request(state.api, payload, state.options)).summary, 'complete')
  assert.equal(posts, 2)
  for (const error of [new Error('timeout'), { statusCode: 503 },
    { statusCode: 503, detail: { code: 'ai_service_unavailable', reason: 'quota' } }]) {
    const failing = fixture([available])
    let attempts = 0
    failing.api.post = async () => { attempts++; throw error }
    await assert.rejects(failing.request(failing.api, payload, failing.options), value => value === error)
    assert.equal(attempts, 1)
  }
})

test('a repeatedly checking POST is bounded and a failed status query never sends a lesson', async () => {
  const state = fixture([available])
  let posts = 0
  state.api.post = async () => {
    posts++
    throw { statusCode: 503, detail: { code: 'ai_service_unavailable', ...checking } }
  }
  await assert.rejects(state.request(state.api, payload, state.options))
  assert.equal(posts, 2)
  const error = new Error('status network failed'), failing = fixture([error])
  await assert.rejects(failing.request(failing.api, payload, failing.options), value => value === error)
  assert.equal(failing.calls.length, 1)
})

test('teacher explains structured availability failures using their specific recovery message', () => {
  const teacher = require('../subpackages/study/utils/ai-teacher-408')
  assert.equal(teacher.errorMessage({ detail: {
    code: 'ai_service_unavailable', message: 'AI 服务检查超时，请稍后重新尝试',
  } }, { getErrorMessage: () => '服务器不可用' }), 'AI 服务检查超时，请稍后重新尝试')
})

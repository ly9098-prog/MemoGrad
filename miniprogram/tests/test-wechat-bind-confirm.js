const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../pages/wechat-bind/confirm.js'), 'utf8')
const challenge = '0123456789abcdef01234567'

function fixture(options = {}, exchange) {
  let definition
  const logins = []
  const requests = []
  const api = {
    async post(...args) {
      requests.push(args)
      return exchange ? exchange() : { status: 'completed' }
    },
    getErrorMessage: error => error.message,
  }
  vm.runInNewContext(source, {
    Page: value => { definition = value },
    require: name => { assert.equal(name, '../../utils/api'); return api },
    wx: {
      async login() { logins.push(true); return { code: 'fixture-wechat-code' } },
      reLaunch() {},
    },
  })
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) },
  }
  page.onLoad(options)
  return { page, logins, requests }
}

test('scanning only opens the confirmation page without logging in or binding', () => {
  const harness = fixture({ scene: encodeURIComponent(challenge) })
  assert.equal(harness.page.data.challenge, challenge)
  assert.equal(harness.logins.length, 0)
  assert.equal(harness.requests.length, 0)
})

test('explicit confirmation exchanges the code without a stored account token', async () => {
  const harness = fixture({ scene: challenge })
  await harness.page.confirmBind()
  assert.equal(harness.logins.length, 1)
  assert.equal(harness.requests.length, 1)
  const [endpoint, payload, options] = harness.requests[0]
  assert.equal(endpoint, '/auth/wechat/bind/confirm')
  assert.equal(payload.challenge_id, challenge)
  assert.equal(payload.code, 'fixture-wechat-code')
  assert.equal(options.auth, 'none')
  assert.equal(harness.page.data.confirming, false)
  assert.match(harness.page.data.result, /微信已绑定/)
})

test('invalid scene and manual codes cannot start a WeChat exchange', async () => {
  const harness = fixture({ scene: '%ZZbad-scene' })
  await harness.page.confirmBind()
  harness.page.onManualChallengeInput({ detail: { value: 'invalid/code' } })
  harness.page.applyManualChallenge()
  assert.equal(harness.page.data.challenge, '')
  assert.equal(harness.logins.length, 0)
  assert.equal(harness.requests.length, 0)
  assert.match(harness.page.data.error, /格式不正确/)
})

test('manual code confirmation cannot be submitted twice while pending', async () => {
  let resolveExchange
  const pending = new Promise(resolve => { resolveExchange = resolve })
  const harness = fixture({}, () => pending)
  harness.page.onManualChallengeInput({ detail: { value: ` ${challenge} ` } })
  harness.page.applyManualChallenge()
  const first = harness.page.confirmBind()
  await harness.page.confirmBind()
  assert.equal(harness.logins.length, 1)
  resolveExchange({ status: 'completed' })
  await first
  assert.equal(harness.requests.length, 1)
})

test('binding conflicts remain failures without registering or signing in', async () => {
  const harness = fixture({ scene: challenge }, async () => { throw new Error('微信已绑定其他账号') })
  await harness.page.confirmBind()
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.page.data.result, '')
  assert.equal(harness.page.data.confirming, false)
  assert.match(harness.page.data.error, /其他账号/)
})

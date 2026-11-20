const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../pages/login/login.js'), 'utf8')

function fixture(resumeOverride, options = {}) {
  let definition, completeCount = 0, resolveCount = 0, finish
  let pendingTarget, targetReady = false
  const timers = new Map(), navigations = [], requests = [], sessions = []
  const values = { token: 't', user: { id: 1 }, ...options.values }
  const resume = resumeOverride || {
    resolve: () => {
      resolveCount++
      if (targetReady) return Promise.resolve(pendingTarget)
      return new Promise(resolve => { finish = resolve })
    },
    complete: () => { completeCount++ },
  }
  const mocks = {
    '../../utils/auth': { isLoggedIn: () => Boolean(values.token),
      getUser: () => values.user,
      syncCurrentUser: async () => values.user,
      loginDirect(token, user, expiresAt, refreshToken) {
        sessions.push({ token, user, expiresAt, refreshToken })
        values.token = token
        values.user = user
      },
      checkAndRefreshToken: options.refresh || (async () => true) },
    '../../utils/api': { normalizeExpiresAt: value => value, now: () => Date.now(),
      resetRedirecting() {},
      async post(url, data, requestOptions) {
        requests.push({ url, data, options: requestOptions })
        return options.post(url, data, requestOptions)
      } },
    '../../utils/storage': { KEYS: { TOKEN: 'token', TOKEN_EXPIRES_AT: 'expires', USER: 'user' },
      get: key => values[key] },
    '../../utils/privacy': { hasAcceptedCurrentPrivacy: () => options.agreed !== false },
    '../../config': {},
    '../../utils/navigation': { getNavigationMetrics: () => ({}) },
    '../../utils/launch-resume': { createLoginResume: () => resume },
    '../../utils/launch-session-store': {
      userId: () => String((values.user || {}).id || ''),
    },
  }
  vm.runInNewContext(source, {
    Page: value => { definition = value },
    require: name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name] },
    wx: { login: async () => ({ code: 'wechat-code' }), showToast() {}, reLaunch: navigation => {
      navigations.push(navigation.url)
      if (options.navigationFails) navigation.fail()
      else if (navigation.success) navigation.success()
    } },
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
    setInterval: () => 1,
    clearInterval() {},
    console, Date,
  })
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad(options.query)
  return {
    page, values, navigations, requests, sessions,
    runTimer: () => { const [id, callback] = [...timers][0]; timers.delete(id); return callback() },
    finish: target => {
      pendingTarget = target
      targetReady = true
      if (finish) finish(target)
    },
    get resolveCount() { return resolveCount },
    get completeCount() { return completeCount },
  }
}

test('login redirects directly to resolved target only after auth and consent succeed', async () => {
  const harness = fixture()
  assert.equal(harness.page.data.entryPending, true)
  const running = harness.runTimer()
  assert.deepEqual(harness.navigations, [])
  harness.finish('/subpackages/study/practice/practice?resume=1')
  await running
  assert.deepEqual(harness.navigations, ['/subpackages/study/practice/practice?resume=1'])
  assert.equal(harness.completeCount, 1)
})

test('account entry displays linked identities without starting login or redirecting', async () => {
  const harness = fixture(undefined, { query: { mode: 'account' }, values: {
    user: { id: 1, email: 'reader@example.com', identities: [{ provider: 'email' }] },
  } })
  await Promise.resolve()
  assert.equal(harness.page.data.accountMode, true)
  assert.equal(harness.page.data.accountEmail, 'reader@example.com')
  assert.equal(harness.page.data.loginMethod, 'wechat')
  assert.equal(harness.page.data.entryPending, false)
  assert.deepEqual(harness.requests, [])
  assert.deepEqual(harness.navigations, [])
})

test('email binding reuses OTP fields and replaces the session for the same owner', async () => {
  const harness = fixture(undefined, { query: { mode: 'account' }, post: async url =>
    url.endsWith('/start') ? { challenge_id: 'challenge', resend_after: 60 }
      : { access_token: 'new', refresh_token: 'refresh', expires_at: 100, user: { id: 1 } },
  })
  harness.page.setData({ email: 'reader@example.com' })
  await harness.page.onEmailSubmit()
  harness.page.setData({ emailCode: '123456' })
  await harness.page.onEmailSubmit()
  assert.deepEqual(harness.requests.map(request => request.url), [
    '/users/me/identities/email/bind/start', '/users/me/identities/email/bind/verify',
  ])
  assert.equal(harness.requests[1].data.client, 'miniprogram')
  assert.equal(harness.sessions.length, 1)
  assert.equal(harness.sessions[0].user.id, 1)
  assert.equal(harness.sessions[0].refreshToken, 'refresh')
})

test('wechat binding only calls the authenticated bind route and keeps the user id', async () => {
  const harness = fixture(undefined, { query: { mode: 'account' }, post: async () => ({
    access_token: 'new', refresh_token: 'refresh', expires_at: 100, user: { id: 1 },
  }) })
  await harness.page.onWechatLogin()
  assert.deepEqual(harness.requests.map(request => request.url), ['/users/me/identities/wechat/bind'])
  assert.equal(harness.requests[0].data.code, 'wechat-code')
  assert.equal(harness.sessions[0].user.id, 1)
})

test('an occupied wechat identity reports the conflict without replacing the session', async () => {
  const harness = fixture(undefined, { query: { mode: 'account' }, post: async () => {
    throw new Error('该微信已绑定到其他账号')
  } })
  await harness.page.onWechatLogin()
  assert.equal(harness.page.data.error, '该微信已绑定到其他账号')
  assert.equal(harness.sessions.length, 0)
  assert.equal(harness.values.token, 't')
})

test('switching accounts during binding cannot restore the previous owner session', async () => {
  let finish, markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const harness = fixture(undefined, { query: { mode: 'account' }, post: () =>
    new Promise(resolve => { finish = resolve; markStarted() }),
  })
  const running = harness.page.onWechatLogin()
  await started
  harness.values.user = { id: 2 }
  finish({ access_token: 'old-owner', user: { id: 1 } })
  await running
  assert.equal(harness.sessions.length, 0)
  assert.equal(harness.values.user.id, 2)
  assert.match(harness.page.data.error, /账号已切换/)
})

test('first-time entry reveals consent and login instead of a stuck startup screen', async () => {
  const harness = fixture(undefined, { values: { token: '' }, agreed: false })
  await Promise.resolve()
  assert.equal(harness.page.data.entryPending, false)
  assert.deepEqual(harness.navigations, [])
})

test('login water motion follows visibility without starting authentication or navigation', () => {
  const harness = fixture(undefined, { values: { token: '' }, agreed: false })
  assert.equal(harness.page.data.discMotionActive, false)
  harness.page.onShow()
  assert.equal(harness.page.data.discMotionActive, true)
  harness.page.onHide()
  assert.equal(harness.page.data.discMotionActive, false)
  harness.page.onShow()
  assert.equal(harness.page.data.discMotionActive, true)
  assert.equal(harness.resolveCount, 0)
  assert.deepEqual(harness.navigations, [])
  harness.page.onUnload()
  let writes = 0
  harness.page.setData = () => { writes++ }
  harness.page.onHide()
  assert.equal(writes, 0, 'destroyed pages must not receive animation updates')
})

test('login without a source stack returns to the explicit deep link including its query', async () => {
  const harness = fixture(undefined, { query: {
    redirect: '/subpackages/study/wrong-detail/wrong-detail?id=23&from=share',
  } })
  await harness.runTimer()
  assert.deepEqual(harness.navigations, [
    '/subpackages/study/wrong-detail/wrong-detail?id=23&from=share',
  ])
  assert.equal(harness.resolveCount, 0)
})

test('failed session validation reveals login without resolving personal recovery', async () => {
  const harness = fixture(undefined, { refresh: async () => false })
  await harness.runTimer()
  assert.equal(harness.page.data.entryPending, false)
  assert.equal(harness.resolveCount, 0)
  assert.deepEqual(harness.navigations, [])
})

test('resolution failure restores interactive login and allows another redirect', async () => {
  let attempts = 0
  const harness = fixture({
    resolve: async () => {
      if (++attempts === 1) throw new Error('unavailable')
      return '/pages/home/home'
    },
    complete() {},
  })
  await harness.runTimer()
  assert.equal(harness.page.data.entryPending, false)
  assert.equal(harness.page.data.loading, false)
  assert.ok(harness.page.data.error)
  harness.page._scheduleHomeRedirect(0)
  assert.equal(harness.page.data.entryPending, true)
  await harness.runTimer()
  assert.deepEqual(harness.navigations, ['/pages/home/home'])
})

test('navigation failure reveals login without consuming the recovery entry', async () => {
  const harness = fixture(undefined, { navigationFails: true })
  const running = harness.runTimer()
  harness.finish('/pages/pomodoro/pomodoro')
  await running
  assert.equal(harness.page.data.entryPending, false)
  assert.ok(harness.page.data.error)
  assert.equal(harness.completeCount, 0)
})

test('an explicit entry arriving during resolution dismisses the startup screen', async () => {
  const harness = fixture()
  const running = harness.runTimer()
  harness.finish(null)
  await running
  assert.equal(harness.page.data.entryPending, false)
  assert.deepEqual(harness.navigations, [])
  assert.equal(harness.completeCount, 0)
})

test('losing consent before the scheduled redirect restores the login controls', async () => {
  const options = {}
  const harness = fixture(undefined, options)
  options.agreed = false
  await harness.runTimer()
  assert.equal(harness.page.data.entryPending, false)
  assert.equal(harness.resolveCount, 0)
  assert.deepEqual(harness.navigations, [])
})

test('an expired local token shows the login form without silently signing in', async () => {
  const harness = fixture(undefined, {
    values: { expires: 1 },
    refresh: async () => { throw new Error('offline') },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(harness.page.data.entryPending, false)
  assert.equal(harness.page.data.loading, false)
  assert.equal(harness.page.data.error, '')
  assert.equal(harness.resolveCount, 0)
  assert.deepEqual(harness.navigations, [])
})

test('hidden login defers redirect and retries on show without becoming stuck', async () => {
  const harness = fixture()
  const running = harness.runTimer()
  harness.page.onHide()
  harness.finish('/pages/pomodoro/pomodoro')
  await running
  assert.deepEqual(harness.navigations, [])
  assert.equal(harness.page._pendingHomeRedirect, true)
  harness.page.onShow()
  const retry = harness.runTimer()
  harness.finish('/pages/pomodoro/pomodoro')
  await retry
  assert.deepEqual(harness.navigations, ['/pages/pomodoro/pomodoro'])
})

test('unload and logout during startup cannot commit a delayed redirect', async () => {
  for (const action of [
    harness => harness.page.onUnload(),
    harness => { harness.values.token = '' },
    harness => { harness.values.user = { id: 2 } },
  ]) {
    const harness = fixture()
    const running = harness.runTimer()
    action(harness)
    harness.finish('/pages/pomodoro/pomodoro')
    await running
    assert.deepEqual(harness.navigations, [])
    assert.equal(harness.completeCount, 0)
    if (!harness.page._pageDestroyed) assert.equal(harness.page.data.entryPending, false)
  }
})

test('show while target resolution is pending coalesces redirect attempts', async () => {
  const harness = fixture()
  const running = harness.runTimer()
  harness.page.onHide()
  harness.page.onShow()
  if (harness.page._homeRedirectTimer) await harness.runTimer()
  assert.equal(harness.resolveCount, 1)
  harness.finish('/pages/home/home')
  await running
  assert.deepEqual(harness.navigations, ['/pages/home/home'])
})

test('a profile refresh for the same identity does not strand the login redirect', async () => {
  const harness = fixture()
  const running = harness.runTimer()
  harness.values.user = { id: 1, nickname: 'updated-profile' }
  harness.finish('/pages/home/home')
  await running
  assert.deepEqual(harness.navigations, ['/pages/home/home'])
})

test('experience-version login uses the real resolver after process reconstruction', async () => {
  const originalWx = global.wx
  const api = require('../utils/api')
  const originalGet = api.get
  const launchPath = require.resolve('../utils/launch-resume')
  const memory = new Map()
  const entry = { path: 'pages/login/login', scene: 1017, query: {} }
  const platform = { getLaunchOptionsSync: () => entry, getEnterOptionsSync: () => entry }
  try {
    global.wx = {
      getStorageSync: key => memory.get(key),
      setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
      removeStorageSync: key => memory.delete(key),
    }
    const store = require('../utils/launch-session-store')
    for (const kind of ['practice', 'pomodoro']) {
      memory.clear()
      memory.set('token', 't')
      memory.set('user', { id: 1 })
      if (kind === 'practice') {
        store.savePractice({ requestId: 'r', batchToken: 'b', questions: [{ id: 1 }],
          currentIndex: 0, elapsedMs: 1000, answerMap: { 1: 'A' } })
      }
      api.get = async () => {
        assert.equal(kind, 'pomodoro')
        return { id: 9, status: 'paused' }
      }
      delete require.cache[launchPath]
      const resume = require(launchPath).createLoginResume(platform)
      const harness = fixture(resume)
      await harness.runTimer()
      assert.deepEqual(harness.navigations, [kind === 'practice'
        ? '/subpackages/study/practice/practice?resume=1' : '/pages/pomodoro/pomodoro'])
      if (kind === 'practice') assert.deepEqual(store.readPractice().answerMap, { 1: 'A' })
      assert.equal(await require(launchPath).createLoginResume(platform).resolve(), '/pages/home/home')
    }
  } finally {
    global.wx = originalWx
    api.get = originalGet
    delete require.cache[launchPath]
  }
})

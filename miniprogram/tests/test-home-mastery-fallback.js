/**
 * Home four-subject mastery and question statistics stay separate.
 *
 * The extracted growth-context builder must receive the study-plan response
 * and keep the dashboard subject statistics available to the mastery cards.
 *
 * Run: node --test tests/test-home-mastery-fallback.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const HOME_PAGE = path.resolve(__dirname, '../pages/home/home.js')
const HOME_UTILS = path.resolve(__dirname, '../pages/home/utils')
const growthAnimation = require('../pages/home/utils/growth-animation')
const { buildSubjectMastery } = require('../pages/home/utils/growth-mastery')

const SUBJECT_STATS = [
  {
    subject_id: 7,
    subject_code: 'data_structure',
    subject_name: '数据结构',
    total_questions: 14,
    correct_count: 3,
    accuracy: 0.2143,
  },
  {
    subject_id: 8,
    subject_code: 'computer_organization',
    subject_name: '计算机组成原理',
    total_questions: 1,
    correct_count: 0,
    accuracy: 0,
  },
  {
    subject_id: 9,
    subject_code: 'operating_system',
    subject_name: '操作系统',
    total_questions: 2,
    correct_count: 1,
    accuracy: 0.5,
  },
  {
    subject_id: 10,
    subject_code: 'computer_network',
    subject_name: '计算机网络',
    total_questions: 1,
    correct_count: 0,
    accuracy: 0,
  },
]

function cloneData(value) {
  return JSON.parse(JSON.stringify(value))
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function withHomePage(run) {
  const modulePath = require.resolve('../pages/home/home')
  const cached = require.cache[modulePath]
  const originalPage = global.Page
  const originalWx = global.wx
  let definition

  global.wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({
      top: 26,
      height: 32,
      left: 280,
    }),
  }
  global.Page = (value) => {
    definition = value
  }

  try {
    delete require.cache[modulePath]
    require(modulePath)
    const page = {
      ...definition,
      data: cloneData(definition.data),
      setData(patch, callback) {
        Object.assign(this.data, patch)
        if (callback) callback()
      },
    }
    Object.assign(page, {
      _alive: true,
      _visible: true,
      _showSeq: 1,
      _growthSeq: 0,
      _animateNumbers() {},
    })
    await run({ page })
  } finally {
    if (cached) require.cache[modulePath] = cached
    else delete require.cache[modulePath]
    if (originalPage === undefined) delete global.Page
    else global.Page = originalPage
    if (originalWx === undefined) delete global.wx
    else global.wx = originalWx
  }
}

function createApi(routes, calls) {
  return {
    get(url) {
      calls.push(url)
      const route = routes[url]
      if (route instanceof Error) return Promise.reject(route)
      if (route && typeof route.then === 'function') return route
      return Promise.resolve(route)
    },
  }
}

function installRoutes(page, routes, calls) {
  page._growthApi = createApi(routes, calls)
}

const HUB = {
  scope_ready: true,
  today_question_count: 6,
  review: { remaining_count: 2 },
  primary_task: {
    key: 'smart:practice',
    task_type: 'smart_practice',
    title: '完成一组智能练习',
    reason: '保持四科训练节奏',
    action_label: '开始练习',
  },
  tasks: [],
  subject_mastery: SUBJECT_STATS.map((item) => ({
    subject_id: item.subject_id,
    subject_code: item.subject_code,
    subject_name: item.subject_name,
    data_available: false,
    mastery_score: null,
    confidence: 0,
    attempt_count: 0,
    accuracy: null,
  })),
}

const PLAN = {
  configured: true,
  plan: { target_date: '2026-12-20' },
  countdown: {
    days_remaining: 49,
    phase_label: '强化阶段',
    target_date: '2026-12-20',
  },
  weekly: { active_days: 3, target_days: 5 },
  today: {
    completed_minutes: 20,
    target_minutes: 60,
    completion_percent: 33,
    allocations: [{ category: 'study', title: '数据结构专项' }],
    primary_category: 'study',
  },
}

function assertQuestionStatsWithoutInventedMastery(subjectMastery) {
  assert.deepEqual(
    subjectMastery.map((item) => item.scoreText),
    ['--', '--', '--', '--'],
  )
  assert.deepEqual(
    subjectMastery.map((item) => item.questionStatText),
    ['3/14 题', '0/1 题', '1/2 题', '0/1 题'],
  )
  assert.deepEqual(
    subjectMastery.map((item) => item.hasData),
    [false, false, false, false],
  )
  assert.ok(subjectMastery.every(item => item.statusText === '样本积累中'))
  assert.deepEqual(subjectMastery.map(item => item.sampleText), ['已练 14 题', '已练 1 题', '已练 2 题', '已练 1 题'])
}

test('successful growth data keeps question statistics without using accuracy as mastery', async () => {
  await withHomePage(async ({ page }) => {
    const calls = []
    installRoutes(page, {
      '/stats/dashboard': {
        overview: {
          consecutive_days: 2,
          today_questions: 6,
          total_questions: 18,
          due_review_count: 2,
        },
        subject_stats: SUBJECT_STATS,
      },
      '/stats/growth': null,
      '/study-hub/overview': HUB,
      '/study-plan/overview': PLAN,
    }, calls)

    await page.loadGrowthSnapshot(1)

    assertQuestionStatsWithoutInventedMastery(page.data.subjectMastery)
    assert.equal(page.data.studyPlanConfigured, true)
    assert.equal(page.data.planDaysRemaining, 49)
    assert.equal(page.data.planPhaseLabel, '强化阶段')
    assert.equal(page.data.planPrimaryText, '数据结构专项')
    assert.deepEqual(
      calls.slice().sort(),
      ['/stats/dashboard', '/stats/growth', '/study-hub/overview', '/study-plan/overview'].sort(),
    )
  })
})

test('growth snapshot builder forwards plan into the display projection', async () => {
  await withHomePage(async ({ page }) => {
    const snapshot = page.buildGrowthSnapshot({
      overview: { consecutive_days: 2, today_questions: 6, total_questions: 18 },
      growth: null,
      hub: HUB,
      plan: PLAN,
      dashboardSubjectStats: SUBJECT_STATS,
    })

    assert.equal(snapshot.studyPlanConfigured, true)
    assert.equal(snapshot.planDaysRemaining, 49)
    assert.equal(snapshot.planTodayText, '今日 20 / 60 分钟')
    assert.equal(snapshot.planWeeklyText, '本周 3 / 5 天')
    assertQuestionStatsWithoutInventedMastery(snapshot.subjectMastery)
  })
})

test('four mastery levels use reliable Hub scores with the reference subject icons', () => {
  const scores = [28, 58, 78, 91]
  const statuses = ['weak', 'developing', 'good', 'mastered']
  const result = buildSubjectMastery({
    hubSubjectMastery: SUBJECT_STATS.map((item, index) => ({
      ...item, mastery_score: scores[index], status: statuses[index],
      confidence: 0.8, data_available: true, attempt_count: 40,
    })),
    dashboardSubjectStats: SUBJECT_STATS,
  })
  assert.deepEqual(result.map(item => item.scoreText), ['28%', '58%', '78%', '91%'])
  assert.deepEqual(result.map(item => item.statusText), ['需要强化', '持续巩固', '较为稳定', '掌握稳固'])
  assert.ok(result.every(item => item.iconSrc.startsWith('/assets/icons/home-mastery/') && item.iconSrc.endsWith('.svg')))
  assert.ok(result.every(item => item.statusIconSrc.endsWith('.svg')))
  assert.equal(result[0].sampleText, '已练 14 题', 'Hub observations never replace the actual question count')
})

test('insufficient samples, unknown scores and unavailable Hub never become zero percent', () => {
  const entries = [
    { ...SUBJECT_STATS[0], mastery_score: 96, status: 'insufficient', confidence: 0.1, attempt_count: 1 },
    { ...SUBJECT_STATS[1], mastery_score: null, confidence: 0.5, attempt_count: 5 },
    { ...SUBJECT_STATS[2], mastery_score: 90, confidence: Infinity, attempt_count: 5 },
  ]
  const result = buildSubjectMastery({ hubSubjectMastery: entries, dashboardSubjectStats: SUBJECT_STATS })
  assert.deepEqual(result.map(item => item.scoreText), ['--', '--', '--', '--'])
  assert.deepEqual(result.map(item => item.statusText), ['样本积累中', '样本积累中', '样本积累中', '评估暂不可用'])
  assert.ok(result.every(item => !item.hasData && item.barWidth === 0))
  const empty = buildSubjectMastery()
  assert.ok(empty.every(item => item.statusText === '开始积累' && item.sampleText === '暂无练习记录'))
})

test('one answer linked to several points is still displayed as one practiced question', () => {
  const result = buildSubjectMastery({
    hubSubjectMastery: [{ ...SUBJECT_STATS[0], mastery_score: 78, confidence: 0.6, attempt_count: 9 }],
    dashboardSubjectStats: [{ ...SUBJECT_STATS[0], total_questions: 1, correct_count: 1 }],
  })
  assert.equal(result[0].attemptCount, 1)
  assert.equal(result[0].questionStatText, '1/1 题')
  assert.equal(result[0].sampleText, '已练 1 题')
})

test('status boundaries use the raw score and respect the server status before display rounding', () => {
  for (const [score, statusText] of [[39.9, '需要强化'], [69.9, '持续巩固'], [84.96, '较为稳定'], [85, '掌握稳固']]) {
    const [item] = buildSubjectMastery({
      hubSubjectMastery: [{ ...SUBJECT_STATS[0], mastery_score: score, confidence: 0.8, attempt_count: 8 }],
    })
    assert.equal(item.statusText, statusText)
    assert.equal(item.sampleText, '已有知识点评估', 'missing question stats are not inferred from observations')
  }
  const [rounded] = buildSubjectMastery({
    hubSubjectMastery: [{ ...SUBJECT_STATS[0], mastery_score: 85, status: 'good', confidence: 0.8 }],
  })
  assert.equal(rounded.statusText, '较为稳定')
})

test('stale growth responses are ignored', async () => {
  await withHomePage(async ({ page }) => {
    const pending = deferred()
    installRoutes(page, {
      '/stats/dashboard': pending.promise,
      '/stats/growth': null,
      '/study-hub/overview': null,
      '/study-plan/overview': null,
    }, [])
    let patchCount = 0
    const setData = page.setData
    page.setData = function (patch, callback) {
      patchCount++
      return setData.call(this, patch, callback)
    }

    const work = page.loadGrowthSnapshot(1)
    page._showSeq = 2
    pending.resolve({ overview: {}, subject_stats: SUBJECT_STATS })
    await work

    assert.equal(patchCount, 0)
    assert.equal(page.data.subjectMastery.length, 0)
  })
})

test('extracted numeric animation commits the exact growth targets', () => {
  const writes = []
  const page = {
    _alive: true,
    _visible: true,
    _animTimer: 'pending',
    data: {
      _animStreakDays: 0,
      _animGoalDone: 0,
      _animLevelProgress: 0,
    },
    setData(patch) {
      writes.push(patch)
      Object.assign(this.data, patch)
    },
  }

  growthAnimation.tick(page, {
    from: { streakDays: 0, goalDone: 0, levelProgress: 0 },
    to: { streakDays: 5, goalDone: 6, levelProgress: 20 },
    durations: { streakDays: 600, goalDone: 600, levelProgress: 500 },
    startTime: Date.now() - 1000,
  })

  assert.deepEqual(writes[writes.length - 1], {
    _animStreakDays: 5,
    _animGoalDone: 6,
    _animLevelProgress: 20,
  })
  assert.equal(page._animTimer, null)
})

test('fresh request failures are logged instead of being silently discarded', async () => {
  await withHomePage(async ({ page }) => {
    const originalError = console.error
    const errors = []
    console.error = (...args) => errors.push(args)
    installRoutes(page, {
      '/stats/dashboard': new Error('dashboard unavailable'),
    }, [])

    try {
      await page.loadGrowthSnapshot(1)
    } finally {
      console.error = originalError
    }

    assert.equal(errors.length, 1)
    assert.equal(errors[0][0], '加载成长数据失败')
    assert.match(errors[0][1].message, /dashboard unavailable/)
  })
})

test('growth responses expose named fields instead of positional entries', async () => {
  await withHomePage(async ({ page }) => {
    const api = createApi({
      '/stats/dashboard': { overview: { total_questions: 18 }, subject_stats: SUBJECT_STATS },
      '/stats/growth': { level_title: 'Lv2 坚持者' },
      '/study-hub/overview': HUB,
      '/study-plan/overview': PLAN,
    }, [])
    page._growthApi = api

    const responses = await page._fetchGrowthResponses()

    assert.deepEqual(Object.keys(responses).sort(), ['dashboard', 'growth', 'hub', 'plan'])
    assert.equal(responses.dashboard.overview.total_questions, 18)
    assert.equal(responses.growth.level_title, 'Lv2 坚持者')
    assert.equal(responses.hub.scope_ready, true)
    assert.equal(responses.plan.configured, true)
  })
})

test('home page stays within 800 lines and delegates growth infrastructure', () => {
  const source = fs.readFileSync(HOME_PAGE, 'utf8')
  const lineCount = source.trimEnd().split('\n').length
  assert.ok(lineCount <= 800, `pages/home/home.js has ${lineCount} lines`)
  assert.match(source, /require\('\.\/utils\/growth-page-controller'\)/)
  assert.doesNotMatch(source, /require\('\.\.\/\.\.\/utils\/(?:api|storage)'\)/)
  for (const filename of [
    'growth-animation.js',
    'growth-client.js',
    'growth-mastery.js',
    'growth-snapshot.js',
    'growth-view.js',
    'home-canvas.js',
  ]) {
    const moduleSource = fs.readFileSync(path.join(HOME_UTILS, filename), 'utf8')
    assert.doesNotMatch(moduleSource, /require\('.*utils\/(?:api|storage)'\)/)
  }
})

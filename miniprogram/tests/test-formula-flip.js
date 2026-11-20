const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const originalWx = global.wx
global.wx = { getWindowInfo: () => ({ windowWidth: 375 }), getDeviceInfo: () => ({ system: 'Node.js' }) }
after(() => { global.wx = originalWx })

let definition
const originalComponent = global.Component
global.Component = value => { definition = value }
require('../subpackages/formulas/components/formula-card/index')
global.Component = originalComponent

function cardInstance(recitationMode = false) {
  return {
    ...definition.methods,
    data: { ...structuredClone(definition.data), recitationMode },
    writes: [], events: [],
    setData(patch, callback) {
      this.writes.push(patch)
      Object.assign(this.data, patch)
      if (callback) callback()
    },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
}

function changeCard(instance, nextCard) {
  const previousCard = instance.data.card
  instance.data.card = nextCard
  definition.properties.card.observer.call(instance, nextCard, previousCard)
}

function changeMode(instance, recitationMode) {
  const previousMode = instance.data.recitationMode
  instance.data.recitationMode = recitationMode
  definition.properties.recitationMode.observer.call(instance, recitationMode, previousMode)
}

test('browsing is the default and cannot accidentally flip', () => {
  const card = cardInstance()
  assert.equal(definition.properties.recitationMode.value, false)
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false)
  assert.equal(card.writes.length, 0)
})

test('recitation flips the same prepared content and returns to the prompt', () => {
  const card = cardInstance(true)
  const formulas = [{ readingRows: [{ lineItems: [{ mathNodes: [{ type: 'text', text: 'x = y' }] }] }] }]
  card.data.formulaBlocks = formulas
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, true)
  assert.equal(card.data.formulaBlocks, formulas)
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false)
  card.data.expandedBlock = {}
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false, 'expanded native reading owns the interaction')
  card.data.expandedBlock = null
  card._readingOpening = true
  card.toggleCardFlip()
  assert.equal(card.data.isFlipped, false, 'pending native reading also owns the interaction')
})

test('swiping, multi-touch and cancellation cannot accidentally flip the card', () => {
  for (const action of ['swipe', 'multi', 'cancel']) {
    const card = cardInstance(true)
    card.onCardTouchStart({ touches: [{ clientX: 180, clientY: 80 }] })
    if (action === 'swipe') card.onCardTouchEnd({ changedTouches: [{ clientX: 100, clientY: 81 }] })
    if (action === 'multi') card.onCardTouchMove({ touches: [{ clientX: 180, clientY: 80 }, { clientX: 200, clientY: 80 }] })
    if (action === 'cancel') card.onCardTouchCancel()
    card.toggleCardFlip()
    assert.equal(card.data.isFlipped, false, action)
    card._flipTapSuppressedUntil = 0
    card.onCardTouchStart({ touches: [{ clientX: 100, clientY: 80 }] })
    card.onCardTouchEnd({ changedTouches: [{ clientX: 102, clientY: 81 }] })
    card.toggleCardFlip()
    assert.equal(card.data.isFlipped, true, 'a normal tap still works')
  }
})

test('updating the same card content resets its face and stale gesture state', () => {
  const card = cardInstance(true)
  const original = { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] }
  changeCard(card, original)
  card.toggleCardFlip()
  card.data.recitationScrollTop = 900
  card.writes = []
  card._flipGesture = { x: 100, y: 80 }
  card._flipTapSuppressedUntil = Date.now() + 500
  const updated = { ...original, title: '乘法法则', formula_blocks: [{ latex: 'a b = b a' }] }
  changeCard(card, updated)
  assert.equal(card.data.isFlipped, false)
  assert.equal(card._flipTapSuppressedUntil, 0)
  assert.equal(card._flipGesture, null)
  assert.ok(card.data.formulaBlocks[0].readingRows.length)
  assert.deepEqual(card.writes.filter(patch => 'recitationScrollTop' in patch),
    [{ recitationScrollTop: 1 }, { recitationScrollTop: 0 }], 'new content starts at the top of either face')
})

test('switching cards resets the answer while favorite metadata keeps the current face', () => {
  const card = cardInstance(true)
  const original = { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] }
  changeCard(card, original)
  card.toggleCardFlip()
  const formulas = card.data.formulaBlocks
  changeCard(card, { ...original, isFavorited: true })
  assert.equal(card.data.isFlipped, true)
  assert.equal(card.data.formulaBlocks, formulas, 'favorite updates do not reparse formulas')
  changeCard(card, { ...original, id: 2 })
  assert.equal(card.data.isFlipped, false)
  assert.equal(card.data.recitationMode, true, 'card navigation preserves the chosen mode')
})

test('changing modes resets the face and cancels stale expanded reading measurements', () => {
  const card = cardInstance(true)
  changeCard(card, { id: 1, title: '乘法', formula_blocks: [{ latex: 'a b' }] })
  const formulas = card.data.formulaBlocks
  card.toggleCardFlip()
  let measured
  const query = {
    selectAll() { return this }, select() { return this }, boundingClientRect() { return this },
    exec(callback) { measured = callback },
  }
  card.createSelectorQuery = () => query
  card.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(card._readingOpening, true)
  card._flipGesture = { x: 100, y: 80 }
  card._flipTapSuppressedUntil = Date.now() + 500
  changeMode(card, false)
  measured([])
  assert.equal(card._readingOpening, false)
  assert.equal(card.data.expandedBlock, null)
  assert.equal(card.data.isFlipped, false)
  assert.equal(card._flipGesture, null)
  assert.equal(card._flipTapSuppressedUntil, 0)
  assert.equal(card.data.formulaBlocks, formulas, 'mode changes reuse prepared math nodes')
  assert.deepEqual(card._readingLayouts, {})
  assert.equal(card.events.at(-1).name, 'formulaend')
  changeMode(card, true)
  card.toggleCardFlip()
  card.openFormulaReading({ currentTarget: { dataset: { index: 0 } } })
  measured([])
  assert.ok(card.data.expandedBlock)
  changeMode(card, false)
  assert.equal(card.data.expandedBlock, null)
  assert.equal(card.events.at(-2).name, 'readingchange')
  assert.equal(card.events.at(-2).detail.expanded, false)
})

let readerDefinition
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../subpackages/formulas/reader/index.js'), 'utf8'), {
  require: () => ({}), Page: value => { readerDefinition = value }, console,
  clearTimeout() {}, setTimeout(callback) { callback(); return 1 },
})

function readerInstance() {
  return {
    ...readerDefinition,
    data: structuredClone(readerDefinition.data),
    _readerAlive: true,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  }
}
const modeEvent = mode => ({ currentTarget: { dataset: { mode } } })

test('library mode changes preserve the list, filters and pagination', () => {
  const runtime = navigationRuntime()
  const library = runtime.loadPage('library')
  const formulas = [{ id: 1 }, { id: 2 }]
  Object.assign(library.data, { formulas, activeChapterId: 4, searchValue: '积分', activeTags: [8], page: 3 })
  library.setReaderMode(modeEvent('recite'))
  assert.equal(library.data.recitationMode, true)
  assert.equal(library.data.formulas, formulas)
  assert.equal(library.data.activeChapterId, 4)
  assert.equal(library.data.searchValue, '积分')
  assert.deepEqual(library.data.activeTags, [8])
  assert.equal(library.data.page, 3)
  library.setReaderMode(modeEvent('browse'))
  assert.equal(library.data.recitationMode, false)
})

test('library rejects invalid modes and restores the chosen mode after reopening', () => {
  const runtime = navigationRuntime()
  const library = runtime.loadPage('library')
  library.setReaderMode(modeEvent('random'))
  assert.equal(library.data.recitationMode, false)
  library.setReaderMode(modeEvent('recite'))
  const reopened = runtime.loadPage('library')
  reopened.syncReaderMode()
  assert.equal(reopened.data.recitationMode, true)
  reopened.setReaderMode(modeEvent(''))
  assert.equal(reopened.data.recitationMode, true)
})

test('ordered and random navigation retain recitation mode', () => {
  const ordered = readerInstance()
  Object.assign(ordered.data, { recitationMode: true, currentCard: { id: 2 }, sequenceIds: [1, 2, 3], sequenceIndex: 1 })
  ordered.syncNavigationState()
  const requests = []
  ordered.loadCard = (...args) => requests.push(args)
  ordered.goPrev()
  ordered.goNext()
  assert.deepEqual(requests.map(args => args[0]), [1, 3])
  assert.equal(ordered.data.recitationMode, true)

  const random = readerInstance()
  const first = { id: 1 }
  const second = { id: 2 }
  Object.assign(random.data, { isRandom: true, recitationMode: true, displayCards: [first, second], currentCard: second, currentIndex: 1 })
  random.syncNavigationState()
  random.goPrev()
  assert.equal(random.data.currentCard, first)
  assert.equal(random.data.recitationMode, true)
  random.goNext()
  assert.equal(random.data.currentCard, second)
  assert.equal(random.data.recitationMode, true)
})

// Load the real page dependencies, including storage-core's actual exports.
// A permissive storage stub used to hide the broken library -> reader sequence.
function navigationRuntime() {
  const memory = new Map([['user', { id: 7 }], ['token', 'formula-test-session-a']])
  const urls = [], requests = []
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375 }),
    getDeviceInfo: () => ({ system: 'Node test' }),
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    removeStorageSync: key => memory.delete(key),
    getStorageInfoSync: () => ({ keys: Array.from(memory.keys()) }),
    navigateTo: value => urls.push(value.url),
    showToast() {},
  }
  global.wx = wx
  const api = {
    now: () => Date.now(),
    async request(method, url, params) {
      requests.push({ method, url, params })
      if (url === '/formulas/favorites/list') return { items: [] }
      if (/^\/formulas\/\d+$/.test(url)) return { id: Number(url.split('/').at(-1)), title: '完整公式' }
      return { items: [] }
    },
  }
  function loadPage(name) {
    const file = path.join(__dirname, `../subpackages/formulas/${name}/index.js`)
    const localRequire = createRequire(file)
    let page
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      require: name => name === '../../../utils/api' ? api :
        name === '../../../utils/auth' ? { isLoggedIn: () => Boolean(memory.get('token')) } : localRequire(name),
      wx, Page: value => { page = value }, console,
      clearTimeout() {}, setTimeout(callback) { callback(); return 1 },
    })
    return { ...page, data: structuredClone(page.data),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
  }
  function open(url) {
    const reader = loadPage('reader')
    reader.onLoad(Object.fromEntries(new URL('https://fixture.local' + url).searchParams))
    return reader
  }
  return { memory, urls, requests, api, loadPage, open }
}
const settleNavigation = () => new Promise(resolve => setImmediate(resolve))

test('real library entry enables both capsule and swipe navigation with real session storage', async () => {
  const runtime = navigationRuntime()
  const library = runtime.loadPage('library')
  library.data.formulas = [{ id: 201 }, { id: 202 }, { id: 203 }]
  library.data.hasMore = false
  library.goToReader({ currentTarget: { dataset: { id: 201 } } })
  assert.ok(runtime.memory.get('reader_sequence'), 'library must save the sequence without swallowing a missing session method')
  const reader = runtime.open(runtime.urls[0])
  await settleNavigation()
  assert.deepEqual(Array.from(reader.data.sequenceIds), [201, 202, 203])
  assert.equal(reader.data.canGoNext, true)
  reader.goNext()
  await settleNavigation()
  assert.equal(reader.data.currentCard.id, 202, 'capsule loads the next card')
  reader.onReaderTouchStart({ touches: [{ clientX: 240, clientY: 100 }] })
  reader.onReaderTouchMove({ touches: [{ clientX: 100, clientY: 103 }] })
  reader.onReaderTouchEnd({ changedTouches: [{ clientX: 100, clientY: 103 }] })
  await settleNavigation()
  assert.equal(reader.data.currentCard.id, 203, 'page swipe loads the next card')
  reader.goPrev()
  await settleNavigation()
  assert.equal(reader.data.currentCard.id, 202, 'previous card remains reachable')
})

test('mode reaches list, random, favorite and direct entries without persisting auth fragments', async () => {
  const runtime = navigationRuntime()
  const library = runtime.loadPage('library')
  library.setReaderMode(modeEvent('recite'))
  library.data.formulas = [{ id: 201 }, { id: 202 }]
  library.data.hasMore = false
  library.goToReader({ currentTarget: { dataset: { id: 201 } } })
  assert.equal(runtime.open(runtime.urls.at(-1)).data.recitationMode, true)
  library.goToRandom()
  const random = runtime.loadPage('reader')
  random.loadRandomCard = () => {}
  random.onLoad(Object.fromEntries(new URL('https://fixture.local' + runtime.urls.at(-1)).searchParams))
  assert.equal(random.data.isRandom, true)
  assert.equal(random.data.recitationMode, true)
  library.goToFavorites()
  assert.equal(new URL('https://fixture.local' + runtime.urls.at(-1)).searchParams.get('mode'), 'recite')
  assert.equal(runtime.open('/subpackages/formulas/reader/index?id=201').data.recitationMode, true)
  const serialized = JSON.stringify(Array.from(runtime.memory.entries()).filter(entry => !['token', 'user'].includes(entry[0])))
  assert.equal(serialized.includes(runtime.memory.get('token')), false, 'no generation/token fragment is persisted in formula caches')
  const storage = require('../utils/storage')
  storage.clearSession()
  assert.equal(runtime.memory.has('reader_sequence'), false)
  assert.equal(Array.from(runtime.memory.keys()).some(key => key.endsWith('formula-reader-mode')), false, 'logout clears the preference through the existing session prefix')
  await settleNavigation()
})

test('owner, logout, guests, expiry and stale requested indexes cannot reuse another sequence or mode', async () => {
  for (const boundary of ['owner', 'logout', 'guest', 'expiry', 'future']) {
    const runtime = navigationRuntime()
    const library = runtime.loadPage('library')
    library.data.formulas = [{ id: 201 }, { id: 202 }]
    library.data.hasMore = false
    library.setReaderMode(modeEvent('recite'))
    library.goToReader({ currentTarget: { dataset: { id: 201 } } })
    const valid = runtime.open(runtime.urls[0].replace('index=0', 'index=1'))
    assert.equal(valid.data.sequenceIndex, 0, 'current ID wins over a stale index')
    if (boundary === 'owner') runtime.memory.set('user', { id: 8 })
    if (boundary === 'logout') require('../utils/storage').clearSession()
    if (boundary === 'guest') runtime.memory.delete('token') // even with a stale stored user
    if (boundary === 'expiry') runtime.memory.get('reader_sequence').savedAt -= 31 * 60 * 1000
    if (boundary === 'future') runtime.memory.get('reader_sequence').savedAt += 60000
    const reader = runtime.open('/subpackages/formulas/reader/index?id=201')
    assert.equal(reader.data.sequenceIds.length, 0, boundary)
    if (!['expiry', 'future'].includes(boundary)) assert.equal(reader.data.recitationMode, false, boundary)
    if (boundary === 'guest') assert.equal(reader.data.guestMode, true)
    await settleNavigation()
  }
})

test('library pagination extends the sequence with the original filters', async () => {
  const runtime = navigationRuntime()
  const originalRequest = runtime.api.request
  runtime.api.request = async (method, url, params) => {
    if (url !== '/formulas') return originalRequest(method, url, params)
    runtime.requests.push({ method, url, params })
    return { items: [{ id: 203 }, { id: 204 }], total: 4 }
  }
  const library = runtime.loadPage('library')
  Object.assign(library.data, { formulas: [{ id: 201 }, { id: 202 }], pageSize: 2, page: 2, hasMore: true,
    activeSubject: 'exam408', activeStudyCardType: 'definition', activeChapterId: 8,
    tags: [{ id: 1, code: 'a&b' }], activeTags: [1], searchValue: 'A&B + 定义', onlyFavorites: true })
  library.goToReader({ currentTarget: { dataset: { id: 202 } } })
  const reader = runtime.open(runtime.urls[0])
  await settleNavigation()
  assert.equal(reader.data.canGoNext, true, 'last loaded card can fetch the next page')
  reader.goNext()
  await settleNavigation()
  assert.equal(reader.data.currentCard.id, 203)
  const request = runtime.requests.find(value => value.url === '/formulas')
  assert.deepEqual({ ...request.params }, { subject_code: 'exam408', exam_scope: 'exam408', chapter_id: '8', tags: 'a&b',
    library_type: 'formula', study_card_type: 'definition', q: 'A&B + 定义', favorite_only: true, page: 2, page_size: 2 })
  assert.deepEqual(Array.from(reader.data.sequenceIds), [201, 202, 203, 204])
})

test('a missing cache recovers the library scope without adding the current cards chapter', async () => {
  const runtime = navigationRuntime()
  const originalRequest = runtime.api.request
  runtime.api.request = async (method, url, params) => {
    if (/^\/formulas\/\d+$/.test(url)) return { id: 201, subject_code: 'math', chapter_id: 9 }
    if (url !== '/formulas') return originalRequest(method, url, params)
    runtime.requests.push({ method, url, params })
    return { items: [{ id: 201 }, { id: 202 }], total: 2 }
  }
  const library = runtime.loadPage('library')
  Object.assign(library.data, { formulas: [{ id: 201 }, { id: 202 }], pageSize: 2, page: 2, hasMore: false })
  library.goToReader({ currentTarget: { dataset: { id: 201 } } })
  runtime.memory.delete('reader_sequence')
  const reader = runtime.open(runtime.urls[0])
  await settleNavigation()
  assert.equal(reader.data.canGoNext, true)
  assert.equal(runtime.requests.find(request => request.url === '/formulas').params.chapter_id, undefined,
    'all chapters stays all chapters during recovery')
})

test('explicit filters and sequences cannot replace the displayed cards navigation context', () => {
  const runtime = navigationRuntime()
  const library = runtime.loadPage('library')
  Object.assign(library.data, { formulas: [{ id: 201 }, { id: 202 }], tags: [{ id: 1, code: 'A' }], activeTags: [1], hasMore: false })
  library.goToReader({ currentTarget: { dataset: { id: 201 } } })
  const changedScope = runtime.open('/subpackages/formulas/reader/index?id=201&subject_code=math&tags=B')
  assert.equal(changedScope.data.sequenceIds.length, 0, 'a previous filter scope cannot override an explicit new one')
  runtime.memory.delete('reader_sequence')
  const unrelated = runtime.open('/subpackages/formulas/reader/index?id=201&ids=11,12&index=0')
  assert.equal(unrelated.data.sequenceIds.length, 0, 'a sequence must contain the displayed card')
})

test('direct-entry sequence recovery finds cards beyond the first 100 and supports the previous page', async () => {
  const runtime = navigationRuntime()
  const originalRequest = runtime.api.request
  runtime.api.request = async (method, url, params) => {
    if (/^\/formulas\/\d+$/.test(url)) return { id: Number(url.split('/').at(-1)), subject_code: 'math' }
    if (url !== '/formulas') return originalRequest(method, url, params)
    runtime.requests.push({ method, url, params })
    return { items: Array.from({ length: params.page === 1 ? 100 : 10 }, (_, index) => ({ id: (params.page - 1) * 100 + index + 1 })), total: 110 }
  }
  const reader = runtime.open('/subpackages/formulas/reader/index?id=101')
  await settleNavigation()
  assert.equal(reader.data.sequenceIds[0], 101)
  assert.equal(reader.data.sequenceHasPrev, true)
  reader.goPrev()
  await settleNavigation()
  assert.equal(reader.data.currentCard.id, 100)
  assert.equal(reader.data.sequenceHasPrev, false)
  assert.deepEqual(runtime.requests.filter(request => request.url === '/formulas').map(request => request.params.page), [1, 2, 1])
})

test('random navigation sends the selected scope instead of dropping its parameters', async () => {
  const runtime = navigationRuntime()
  const originalRequest = runtime.api.request
  runtime.api.request = async (method, url, params) => {
    if (url !== '/formulas/random/next') return originalRequest(method, url, params)
    runtime.requests.push({ method, url, params })
    return { id: 208 }
  }
  const reader = runtime.open('/subpackages/formulas/reader/index?random=1&subject_code=exam408&exam_scope=exam408&chapter_id=8&tags=a%26b&library_type=formula&study_card_type=definition&mode=recite')
  await settleNavigation()
  assert.equal(reader.data.currentCard.id, 208)
  assert.equal(reader.data.recitationMode, true)
  assert.deepEqual({ ...runtime.requests.find(request => request.url === '/formulas/random/next').params }, {
    subject_code: 'exam408', exam_scope: 'exam408', chapter_id: '8', tags: 'a&b', library_type: 'formula', study_card_type: 'definition',
  })
})

test('reader accepts an endpoint-only swipe but rejects vertical, multi-touch, cancelled and expanded gestures', () => {
  const reader = readerInstance()
  reader.goNext = () => { reader.nextCount = (reader.nextCount || 0) + 1 }
  const start = { touches: [{ clientX: 240, clientY: 100 }] }
  const end = { changedTouches: [{ clientX: 100, clientY: 103 }] }
  reader.onReaderTouchStart(start)
  reader.onReaderTouchEnd(end)
  assert.equal(reader.nextCount, 1, 'native platforms may coalesce move events')
  for (const gesture of ['vertical', 'multi', 'cancel', 'expanded', 'formula']) {
    reader.onReaderTouchStart(start)
    if (gesture === 'vertical') reader.onReaderTouchMove({ touches: [{ clientX: 235, clientY: 180 }] })
    if (gesture === 'multi') reader.onReaderTouchMove({ touches: [{ clientX: 150, clientY: 101 }, { clientX: 180, clientY: 110 }] })
    if (gesture === 'cancel') reader.onReaderTouchCancel()
    if (gesture === 'expanded') reader.data.formulaReadingExpanded = true
    if (gesture === 'formula') reader.onFormulaGestureStart()
    reader.onReaderTouchEnd(end)
    assert.equal(reader.nextCount, 1, gesture)
    reader.data.formulaReadingExpanded = false
    reader._formulaGestureActive = false
  }
})

test('late sequence/card responses cannot write after unload or a session change', async () => {
  for (const boundary of ['unload', 'session']) {
    const runtime = navigationRuntime()
    let resolve
    runtime.api.request = () => new Promise(done => { resolve = done })
    const reader = runtime.open('/subpackages/formulas/reader/index?id=201')
    if (boundary === 'unload') reader.onUnload()
    else require('../utils/storage').clearSession()
    resolve({ id: 201 })
    await settleNavigation()
    assert.equal(reader.data.currentCard, null, boundary)
    const writes = []
    reader.setData = patch => writes.push(patch)
    const pending = reader.ensureSequence({ id: 201, subject_code: 'math' })
    resolve({ items: [{ id: 201 }, { id: 202 }], total: 2 })
    await pending
    assert.equal(writes.length, 0, boundary)
  }
})

test('library session changes clear previous favorite membership and block stale navigation', () => {
  const runtime = navigationRuntime()
  const library = runtime.loadPage('library')
  for (const method of ['measureNavigation', 'loadCatalog', 'loadTags', 'loadFavoriteIds', 'loadFormulas']) library[method] = () => {}
  library.onLoad({ favorites: '1' })
  library.onShow()
  Object.assign(library.data, { formulas: [{ id: 201, isFavorited: true }], favoriteIds: [201], onlyFavorites: true })
  runtime.memory.delete('token')
  library.goToReader({ currentTarget: { dataset: { id: 201 } } })
  assert.equal(runtime.urls.length, 0, 'an old owners list must not be stamped with the new session')
  library.onShow()
  assert.equal(library.data.guestMode, true)
  assert.equal(library.data.onlyFavorites, false)
  assert.equal(library.data.favoriteIds.length, 0)
  assert.equal(library.data.formulas.length, 0)
})

// These cases load the real API/auth/storage graph in a fresh module realm.
// Only the wx platform is supplied; no authentication or request method is stubbed.
function renewalRuntime(persistedMemory) {
  const memory = persistedMemory || new Map()
  const requests = [], pending = [], modules = new Map()
  let loginOwner = 7, loginCount = 0, refreshCount = 0, holdPath = ''
  let registeredPage
  const expiresLater = () => Math.floor(Date.now() / 1000) + 7200
  function responseData(url, options) {
    if (url === '/auth/login') return {
      access_token: `fixture-login-${++loginCount}-not-a-credential`,
      refresh_token: 'fixture-refresh-not-a-credential', expires_at: expiresLater(), user: { id: loginOwner },
    }
    if (url === '/auth/refresh') return {
      access_token: `fixture-renew-${++refreshCount}-not-a-credential`,
      refresh_token: 'fixture-rotated-refresh-not-a-credential', expires_at: expiresLater(), user: memory.get('user'),
    }
    if (/^\/formulas\/\d+$/.test(url)) return { id: Number(url.split('/').at(-1)), title: '完整公式' }
    if (url === '/formulas') return { items: [{ id: 201, title: '完整公式' }, { id: 202, title: '另一公式' }], total: 2 }
    if (url === '/formulas/catalog') return { items: [{ code: 'math', name: '数学', children: [{ id: 1, name: '第一章' }] }] }
    return { items: [], total: 0 }
  }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375 }),
    getDeviceInfo: () => ({ system: 'Node test' }),
    getStorageSync: key => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    removeStorageSync: key => memory.delete(key),
    getStorageInfoSync: () => ({ keys: Array.from(memory.keys()) }),
    login: async () => ({ code: 'fixture-wechat-code' }),
    showToast() {}, navigateTo() {},
    request(options) {
      const url = new URL(options.url).pathname.replace(/^\/api\/v1/, '')
      requests.push({ url, method: options.method, data: options.data, header: options.header })
      const data = responseData(url, options)
      const reply = () => options.success({ statusCode: 200, data, header: {} })
      if (url === holdPath) pending.push(reply)
      else queueMicrotask(reply)
    },
  }
  const context = vm.createContext({ wx, console, setTimeout, clearTimeout, queueMicrotask,
    Page(value) { registeredPage = value } })
  function loadModule(file) {
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    const nativeRequire = createRequire(file)
    const localRequire = name => name.startsWith('.')
      ? loadModule(nativeRequire.resolve(name)) : nativeRequire(name)
    const wrapper = vm.runInContext('(function(require, module, exports, __filename, __dirname) {\n' +
      fs.readFileSync(file, 'utf8') + '\n})', context, { filename: file })
    wrapper(localRequire, module, module.exports, file, path.dirname(file))
    return module.exports
  }
  const utility = name => loadModule(path.resolve(__dirname, '../utils', name + '.js'))
  const auth = utility('auth'), api = utility('api'), storage = utility('storage')
  const state = loadModule(path.resolve(__dirname, '../subpackages/formulas/utils/formula-reader-state.js'))
  function page(name) {
    loadModule(path.resolve(__dirname, `../subpackages/formulas/${name}/index.js`))
    return { ...registeredPage, data: structuredClone(registeredPage.data),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() } }
  }
  return { memory, requests, auth, api, storage, state, page,
    async login(owner = 7) { loginOwner = owner; await auth.wechatLogin() },
    expireSoon() { storage.setStrict(storage.KEYS.TOKEN_EXPIRES_AT, Math.floor(Date.now() / 1000) + 60) },
    hold(url) { holdPath = url },
    release() { holdPath = ''; pending.splice(0).forEach(reply => reply()) },
    get pendingCount() { return pending.length },
  }
}

function saveRenewalPreference(runtime) {
  runtime.state.writeMode('recite')
  runtime.state.writeSequence({ ids: [201, 202], index: 0, params: { subject_code: 'math' },
    firstPage: 1, nextPage: 2, pageSize: 20, hasMore: false }, runtime.api.now())
}

test('real proactive refresh preserves the reader response, mode, sequence and navigation', async () => {
  const runtime = renewalRuntime()
  await runtime.login()
  saveRenewalPreference(runtime)
  const generation = runtime.storage.currentSessionGeneration()
  const token = runtime.auth.getToken()
  runtime.expireSoon()
  const reader = runtime.page('reader')
  reader.onLoad({ id: '201', source: 'library', subject_code: 'math' })
  await settleNavigation()
  assert.equal(runtime.requests.filter(request => request.url === '/auth/refresh').length, 1)
  assert.notEqual(runtime.auth.getToken(), token, 'the real API must rotate the access token')
  assert.equal(runtime.storage.currentSessionGeneration(), generation, 'renewal is the same authenticated session')
  assert.equal(reader.data.currentCard && reader.data.currentCard.id, 201, 'the successful post-refresh response must be applied')
  assert.equal(reader.data.loading, false)
  assert.equal(reader.readerSessionValid(), true)
  assert.equal(reader.data.recitationMode, true)
  assert.deepEqual(Array.from(reader.data.sequenceIds), [201, 202])
  assert.equal(reader.data.canGoNext, true)
  const detailRequest = runtime.requests.find(request => request.url === '/formulas/201')
  assert.equal(detailRequest.header.Authorization, `Bearer ${runtime.auth.getToken()}`)
  assert.equal(runtime.state.readMode(), 'recite')
  assert.deepEqual(Array.from(runtime.state.readSequence(201, runtime.api.now()).ids), [201, 202])
  reader.onShow()
  await reader.loadCard(202, { sequenceIndex: 1 })
  assert.equal(reader.data.currentCard.id, 202, 'the renewed reader can still load another card')
  assert.equal(reader.data.canGoPrev, true)
  reader.onUnload()
})

test('real proactive refresh preserves the library list, catalog, mode and ability to reload', async () => {
  const runtime = renewalRuntime()
  await runtime.login()
  saveRenewalPreference(runtime)
  const generation = runtime.storage.currentSessionGeneration()
  const token = runtime.auth.getToken()
  runtime.expireSoon()
  const library = runtime.page('library')
  library.onLoad()
  library.onShow()
  await settleNavigation()
  assert.equal(runtime.requests.filter(request => request.url === '/auth/refresh').length, 1, 'concurrent initial requests share renewal')
  assert.notEqual(runtime.auth.getToken(), token)
  assert.equal(runtime.storage.currentSessionGeneration(), generation)
  assert.equal(library.data.initialLoading, false, 'the successful post-refresh list must end loading')
  assert.deepEqual(Array.from(library.data.formulas, card => card.id), [201, 202])
  assert.equal(library.data.catalog.length, 1)
  assert.equal(library.librarySessionValid(), true)
  assert.equal(library.data.recitationMode, true)
  assert.equal(runtime.state.readMode(), 'recite')
  assert.deepEqual(Array.from(runtime.state.readSequence(201, runtime.api.now()).ids), [201, 202])
  library.onShow()
  library.reload()
  await settleNavigation()
  assert.equal(library.data.initialLoading, false)
  assert.equal(library.data.formulas.length, 2)
  library.onUnload()
})

test('real auth logout, account switching and same-account relogin invalidate old page responses', async t => {
  for (const pageName of ['reader', 'library']) {
    for (const boundary of ['logout', 'switch-account', 'same-account-relogin']) {
      await t.test(`${pageName}: ${boundary}`, async () => {
        const runtime = renewalRuntime()
        await runtime.login()
        saveRenewalPreference(runtime)
        const generation = runtime.storage.currentSessionGeneration()
        runtime.hold(pageName === 'reader' ? '/formulas/201' : '/formulas')
        const page = runtime.page(pageName)
        if (pageName === 'reader') page.onLoad({ id: '201', source: 'library', subject_code: 'math' })
        else page.onLoad()
        await settleNavigation()
        assert.equal(runtime.pendingCount, 1, 'the old session has a successful response waiting at wx.request')
        if (boundary !== 'switch-account') await runtime.auth.logout()
        if (boundary === 'switch-account') await runtime.login(8)
        if (boundary === 'same-account-relogin') await runtime.login(7)
        assert.equal(runtime.memory.has('reader_sequence'), false, 'clearing identity removes the old sequence')
        assert.equal(runtime.state.readMode(), 'browse', 'the old session preference is removed')
        assert.notEqual(runtime.storage.currentSessionGeneration(), generation)
        const isValid = pageName === 'reader' ? page.readerSessionValid() : page.librarySessionValid()
        assert.equal(isValid, false, 'the old runtime must remain invalid even after the same account returns')
        runtime.release()
        await settleNavigation()
        if (pageName === 'reader') assert.equal(page.data.currentCard, null, 'old response must not replace the current card')
        else assert.equal(page.data.formulas.length, 0, 'old response must not repopulate another session list')
        page.onUnload()
      })
    }
  }
})

test('formula preferences survive a new app runtime without persisting token or runtime generations', async () => {
  const first = renewalRuntime()
  await first.login()
  // Ensure the first runtime has a different revision than a fresh app.
  await first.auth.logout()
  await first.login()
  saveRenewalPreference(first)
  const sequence = first.memory.get('reader_sequence')
  assert.equal('sessionGeneration' in sequence, false)
  assert.equal('sessionRevision' in sequence, false)
  assert.equal(JSON.stringify(sequence).includes(first.auth.getToken()), false)
  const reopened = renewalRuntime(first.memory)
  assert.equal(reopened.state.readMode(), 'recite')
  assert.deepEqual(Array.from(reopened.state.readSequence(201, reopened.api.now()).ids), [201, 202])
})

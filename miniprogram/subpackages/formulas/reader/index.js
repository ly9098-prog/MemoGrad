const api = require('../../../utils/api')
const auth = require('../../../utils/auth')
const storage = require('../../../utils/storage')
const readerState = require('../utils/formula-reader-state')
const { resolveGraphImageUrl, resolveGraphThumbnailUrl } = require('../utils/formula-graph')
const { parseServerUtc, getChinaWallParts } = require('../../../utils/china-time')

function formulaNowMs() {
  const synced = api && typeof api.now === 'function' ? Number(api.now()) : NaN
  return Number.isFinite(synced) ? synced : Date.now()
}

function formatChinaDateTime(value) {
  const ms = typeof value === 'number' ? value : parseServerUtc(value)
  if (!Number.isFinite(ms)) return ''
  const p = getChinaWallParts(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
}

const MAX_RANDOM_HISTORY = 24
const MAX_SEQUENCE_SEARCH_PAGES = 10
const TRANSITION_OUT_MS = 150
const TRANSITION_IN_DELAY_MS = 36
const READER_SWIPE_MIN_DISTANCE = 28
const READER_SWIPE_FLICK_MIN_DISTANCE = 18
const READER_SWIPE_FLICK_VELOCITY = 0.3
const READER_SWIPE_HORIZONTAL_DOMINANCE = 1.2

const STUDY_CARD_TYPE_LABEL = {
  formula: '公式',
  definition: '定义',
  complexity: '算法复杂度',
  protocol_rule: '协议字段 / 规则',
  key_conclusion: '高频结论',
  confusable: '易混概念',
  trap: '典型陷阱',
  comparison: '对比卡',
}

function studyCardTypeLabel(card) {
  var key = String(card?.study_card_type || card?.studyCardType || 'formula').trim().toLowerCase()
  return STUDY_CARD_TYPE_LABEL[key] || '速记'
}

function normalizeId(value) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  return /^\d+$/.test(text) ? Number(text) : text
}

function sameId(a, b) {
  return a !== null && b !== null && String(a) === String(b)
}

function normalizeSequence(values) {
  const result = []
  ;(values || []).forEach((value) => {
    const id = normalizeId(value)
    if (id !== null && !result.some((item) => sameId(item, id))) result.push(id)
  })
  return result
}

Page({
  data: {
    guestMode: false,
    displayCards: [],
    currentCard: null,
    currentIndex: 0,
    loading: true,
    loadingNext: false,
    favoriteBusy: false,
    loadError: false,
    errorText: '',
    formulaId: null,
    sequenceIds: [],
    sequenceIndex: 0,
    sequenceHasPrev: false,
    sequenceHasNext: false,
    canGoPrev: false,
    canGoNext: false,
    readerScrollTop: 0,
    formulaReadingExpanded: false,
    recitationMode: false,
    recitationHeight: 0,
    recitationNeedsScroll: false,
    transitionClass: '',

    isRandom: false,
    randomParams: {},
  },

  onLoad(options = {}) {
    this._readerAlive = true
    this._readerVisible = true
    this._navigatingBack = false
    this._readerSession = readerState.sessionIdentity()
    this.setData({ guestMode: !auth.isLoggedIn(), recitationMode: readerState.readMode(options.mode) === 'recite' })
    this.updateReaderViewport()
    const formulaId = normalizeId(options.id)
    const isRandom = options.random === '1'
    let sequenceIds = normalizeSequence(String(options.ids || '').split(',').filter(Boolean))
    if (!sequenceIds.some(id => sameId(id, formulaId))) sequenceIds = []

    const cached = !isRandom && sequenceIds.length <= 1 ? readerState.readSequence(formulaId, formulaNowMs(), options) : null
    if (cached) sequenceIds = normalizeSequence(cached.ids)
    const firstPage = Math.max(1, Number(cached ? cached.firstPage : options.sequence_page) || 1)
    this._sequenceContext = {
      params: readerState.sequenceFilters(cached ? cached.params : options),
      firstPage,
      nextPage: Math.max(firstPage + 1, Number(cached && cached.nextPage) || firstPage + 1),
      pageSize: Math.min(100, Math.max(1, Number(cached ? cached.pageSize : options.page_size) || 100)),
      hasMore: Boolean(cached && cached.hasMore),
    }

    const requestedIndex = parseInt(options.index, 10)
    const inferredIndex = sequenceIds.findIndex((id) => sameId(id, formulaId))
    const sequenceIndex = inferredIndex >= 0 ? inferredIndex : Number.isFinite(requestedIndex) && requestedIndex >= 0
      ? Math.min(requestedIndex, Math.max(0, sequenceIds.length - 1)) : 0

    this.setData({ formulaId, isRandom, sequenceIds, sequenceIndex,
      sequenceHasPrev: Boolean(cached && firstPage > 1), sequenceHasNext: Boolean(cached && cached.hasMore),
    }, () => this.syncNavigationState())

    if (isRandom) {
      const params = readerState.sequenceFilters(options)
      // Random API supports scope/type/tags, but not q or favorite_only.
      delete params.q
      delete params.favorite_only
      this.setData({ randomParams: params })
      this.loadRandomCard({ append: false })
      return
    }

    if (formulaId !== null) {
      this.loadCard(formulaId)
      return
    }

    this.setData({
      loading: false,
      loadError: true,
      errorText: '缺少公式编号，请返回公式库重新选择',
    })
  },

  onShow() {
    if (this.readerSessionValid()) {
      this._readerVisible = true
      return
    }
    this.onUnload()
    this.setData({ currentCard: null, displayCards: [], sequenceIds: [], loading: false, loadingNext: false,
      canGoPrev: false, canGoNext: false, loadError: true, errorText: '登录状态已更新，请返回速记卡库重新选择' })
  },

  onHide() {
    this._readerVisible = false
    clearTimeout(this._formulaGestureTimer)
    this._formulaGestureActive = false
    this._readerGesture = null
  },

  readerSessionValid() {
    return !this._readerSession || readerState.sameSession(this._readerSession)
  },

  onReady() {
    this.refineReaderViewport()
  },

  onResize(event = {}) {
    this.updateReaderViewport(event.size)
  },

  updateReaderViewport(size = {}) {
    let info = {}, menu = null
    try { info = wx.getWindowInfo() } catch (_) {}
    try { menu = wx.getMenuButtonBoundingClientRect() } catch (_) {}
    const width = Number(size.windowWidth || info.windowWidth)
    const height = Number(size.windowHeight || info.windowHeight)
    if (!(width > 0 && height > 0)) return
    const rpx = width / 750
    const status = Number(info.statusBarHeight || 20)
    const navHeight = status + Number(menu && menu.height || 32) + Math.max(4, Number(menu && menu.top || status + 6) - status) * 2
    const bottomInset = Math.max(0, Number(info.screenHeight || height) - Number(info.safeArea && info.safeArea.bottom || info.screenHeight || height))
    // Navigation floats over the footer; only the safe area and outer gap
    // reduce the stable stage. Its visibility never changes card geometry.
    const footerHeight = bottomInset + 12
    this._readerLayout = { height, footerHeight }
    this._readerLayoutMeasured = false
    this._readerLayoutToken = (this._readerLayoutToken || 0) + 1
    const available = height - navHeight - 22 * rpx - 44 - 28 * rpx - footerHeight
    this.setData({ recitationHeight: Math.max(240, Math.floor(available)), recitationNeedsScroll: available < 240 }, () => this.refineReaderViewport())
  },

  refineReaderViewport() {
    if (!this._readerAlive || !this._readerLayout || this._readerLayoutMeasured || !this.data.currentCard || !this.createSelectorQuery) return
    const token = this._readerLayoutToken
    this.createSelectorQuery().select('.fr-reader-meta').boundingClientRect().exec(rects => {
      if (!this._readerAlive || token !== this._readerLayoutToken || !rects || !rects[0]) return
      const available = this._readerLayout.height - rects[0].bottom - (this._readerScrollOffset || 0) - this._readerLayout.footerHeight
      if (!Number.isFinite(available)) return
      this._readerLayoutMeasured = true
      this.setData({ recitationHeight: Math.max(240, Math.floor(available)), recitationNeedsScroll: available < 240 })
    })
  },

  onUnload() {
    this._readerAlive = false
    this._readerVisible = false
    clearTimeout(this._transitionTimer)
    clearTimeout(this._transitionInTimer)
    clearTimeout(this._formulaGestureTimer)
    this._cardRequestToken = (this._cardRequestToken || 0) + 1
    this._randomRequestToken = (this._randomRequestToken || 0) + 1
    this._sequenceRequestToken = (this._sequenceRequestToken || 0) + 1
    this._readerLayoutToken = (this._readerLayoutToken || 0) + 1
    this._readerGesture = null
    this._formulaGestureActive = false
  },

  goBack() {
    // Prevent two fast taps from issuing overlapping navigation commands.
    // WeChat can otherwise report `routeDone ... is not the current page` when
    // the first navigation has already detached this reader webview.
    if (this._navigatingBack) return
    this._navigatingBack = true
    const pages = getCurrentPages()
    const fail = () => {
      if (this._readerAlive) this._navigatingBack = false
    }
    if (pages.length > 1) wx.navigateBack({ fail })
    else wx.reLaunch({ url: '/subpackages/formulas/library/index', fail })
  },

  syncNavigationState() {
    const { isRandom, currentIndex, sequenceIndex } = this.data
    const sequenceIds = Array.isArray(this.data.sequenceIds) ? this.data.sequenceIds : []
    this.setData({
      canGoPrev: isRandom ? currentIndex > 0 : sequenceIds.length > 0 && (sequenceIndex > 0 || this.data.sequenceHasPrev),
      canGoNext: isRandom ? true : sequenceIds.length > 0 && (sequenceIndex < sequenceIds.length - 1 || this.data.sequenceHasNext),
    })
  },

  async fetchCard(formulaId) {
    const data = await api.request('GET', `/formulas/${formulaId}`, {}, { auth: 'optional' })
    return this.enrichCard(data || {})
  },

  applyCardTransition(card, direction, patch = {}) {
    if (!card || typeof card !== 'object') {
      this.setData({ loadingNext: false, transitionClass: '' })
      return
    }
    clearTimeout(this._transitionTimer)
    clearTimeout(this._transitionInTimer)
    clearTimeout(this._formulaGestureTimer)
    this._readerGesture = null
    this._formulaGestureActive = false

    const goingNext = direction !== 'prev'
    const outClass = goingNext ? 'fr-slide-out-left' : 'fr-slide-out-right'
    const inClass = goingNext ? 'fr-slide-in-right' : 'fr-slide-in-left'

    this.setData({ transitionClass: outClass })
    this._transitionTimer = setTimeout(() => {
      if (!this._readerAlive || !this.readerSessionValid()) return
      this.setData({
        ...patch,
        currentCard: card,
        loading: false,
        loadingNext: false,
        transitionClass: inClass,
      }, () => {
        this.resetReaderScroll()
        this.syncNavigationState()
        this._transitionInTimer = setTimeout(() => {
          if (!this._readerAlive || !this.readerSessionValid()) return
          this.setData({ transitionClass: '' })
        }, TRANSITION_IN_DELAY_MS)
      })
    }, TRANSITION_OUT_MS)
  },

  async loadCard(formulaId, {
    transition = false,
    sequenceIndex = this.data.sequenceIndex,
    direction = "next",
  } = {}) {
    if (!this._readerAlive || !this.readerSessionValid()) return
    var requestToken = (this._cardRequestToken || 0) + 1
    this._cardRequestToken = requestToken
    var loadingKey = transition ? "loadingNext" : "loading"
    this.setData({ [loadingKey]: true, loadError: false, errorText: "" })
    try {
      var card = await this.fetchCard(formulaId)
      if (requestToken !== this._cardRequestToken || !this._readerAlive || !this.readerSessionValid()) return
      if (!card || typeof card !== "object") throw new Error("公式数据无效")
      this._applyLoadedCard(card, formulaId, transition, direction, sequenceIndex)
    } catch (err) {
      this._handleLoadCardError(err, requestToken, transition)
    }
  },

  _applyLoadedCard(card, formulaId, transition, direction, sequenceIndex) {
    var resolvedId = normalizeId(card.id || formulaId)
    var patch = { displayCards: [card], currentIndex: 0, formulaId: resolvedId, sequenceIndex: sequenceIndex }
    if (transition && this.data.currentCard) {
      this.applyCardTransition(card, direction, patch)
    } else {
      var self = this
      this.setData(Object.assign({}, patch, { currentCard: card, loading: false, loadingNext: false, transitionClass: "" }), function() { self.resetReaderScroll(); self.syncNavigationState() })
    }
    if (!this.data.isRandom && !this.data.sequenceIds.length) {
      this.ensureSequence(card).catch(function() {})
    }
  },

  _handleLoadCardError(err, requestToken, transition) {
    if (requestToken !== this._cardRequestToken || !this._readerAlive || !this.readerSessionValid()) return
    console.error("Failed to load formula", err)
    if (transition) {
      this.setData({ loadingNext: false, transitionClass: "" })
      wx.showToast({ title: "切换失败，请重试", icon: "none" })
    } else {
      this.setData({ loading: false, loadError: true, errorText: err && err.message ? err.message : "公式加载失败，请稍后重试" })
    }
  },

  async ensureSequence(card) {
    if (!this._readerAlive || !this.readerSessionValid()) return
    const requestToken = this._sequenceRequestToken = (this._sequenceRequestToken || 0) + 1
    const previousId = normalizeId(card.prev_id || card.previous_id || (card.navigation && card.navigation.prev_id))
    const nextId = normalizeId(card.next_id || card.following_id || (card.navigation && card.navigation.next_id))
    const currentId = normalizeId(card.id || this.data.formulaId)

    if (previousId !== null || nextId !== null) {
      const ids = normalizeSequence([previousId, currentId, nextId])
      const index = Math.max(0, ids.findIndex((id) => sameId(id, currentId)))
      this.setData({ sequenceIds: ids, sequenceIndex: index }, () => this.syncNavigationState())
      return
    }

    const context = this._sequenceContext || { params: {}, firstPage: 1, pageSize: 100 }
    const params = { ...context.params, page_size: context.pageSize }
    const subjectCode = card.subject_code || card.subjectCode || (card.subject && card.subject.code)
    const chapterId = card.chapter_id || card.chapterId || (card.chapter && card.chapter.id)
    if (!params.subject_code && !params.chapter_id && !params.category_id) {
      if (subjectCode) params.subject_code = subjectCode
      if (chapterId) params.chapter_id = chapterId
    }
    if (!params.subject_code && !params.chapter_id && !params.category_id) return

    for (let attempt = 0, page = context.firstPage; attempt < MAX_SEQUENCE_SEARCH_PAGES; attempt++, page++) {
      const data = await api.request('GET', '/formulas', { ...params, page }, { auth: 'optional' })
      if (!this._readerAlive || !this.readerSessionValid() || requestToken !== this._sequenceRequestToken ||
          !sameId(currentId, this.data.formulaId)) return
      const items = data && Array.isArray(data.items) ? data.items : []
      const ids = normalizeSequence(items.map(item => item.id))
      const index = ids.findIndex(id => sameId(id, currentId))
      const hasMore = this.sequencePageHasMore(data, page, context.pageSize, items.length)
      if (index >= 0) {
        this._sequenceContext = { params: readerState.sequenceFilters(params), firstPage: page, nextPage: page + 1, pageSize: context.pageSize, hasMore }
        this.setData({ sequenceIds: ids, sequenceIndex: index, sequenceHasPrev: page > 1, sequenceHasNext: hasMore }, () => this.syncNavigationState())
        return
      }
      if (!hasMore) return
    }
  },

  sequencePageHasMore(data, page, pageSize, itemCount) {
    const rawTotal = data && (data.filtered_total != null ? data.filtered_total : data.total)
    const total = Number(rawTotal)
    return rawTotal != null && Number.isFinite(total) ? page * pageSize < total : itemCount === pageSize
  },

  async extendSequence(direction) {
    const context = this._sequenceContext
    if (!context || !this.readerSessionValid()) return
    const requestToken = this._sequenceRequestToken = (this._sequenceRequestToken || 0) + 1
    const currentId = this.data.formulaId
    const page = direction === 'prev' ? context.firstPage - 1 : context.nextPage
    if (page < 1) return
    this.setData({ loadingNext: true })
    try {
      const data = await api.request('GET', '/formulas', { ...context.params, page, page_size: context.pageSize }, { auth: 'optional' })
      if (!this._readerAlive || !this.readerSessionValid() || requestToken !== this._sequenceRequestToken || !sameId(currentId, this.data.formulaId)) return
      const items = data && Array.isArray(data.items) ? data.items : []
      const extra = normalizeSequence(items.map(item => item.id))
      const ids = normalizeSequence(direction === 'prev' ? extra.concat(this.data.sequenceIds) : this.data.sequenceIds.concat(extra))
      if (direction === 'prev') context.firstPage = page
      else {
        context.nextPage = page + 1
        context.hasMore = this.sequencePageHasMore(data, page, context.pageSize, items.length)
      }
      const currentIndex = ids.findIndex(id => sameId(id, currentId))
      this.setData({ sequenceIds: ids, sequenceIndex: currentIndex, loadingNext: false,
        sequenceHasPrev: context.firstPage > 1, sequenceHasNext: context.hasMore }, () => this.syncNavigationState())
      const nextIndex = currentIndex + (direction === 'prev' ? -1 : 1)
      if (ids[nextIndex] != null) await this.loadCard(ids[nextIndex], { transition: true, sequenceIndex: nextIndex, direction })
    } catch (_) {
      if (!this._readerAlive || !this.readerSessionValid() || requestToken !== this._sequenceRequestToken) return
      this.setData({ loadingNext: false })
      wx.showToast({ title: '切换失败，请重试', icon: 'none' })
    }
  },

  async loadRandomCard({ append = false } = {}) {
    if (!this._readerAlive || !this.readerSessionValid()) return
    var requestToken = (this._randomRequestToken || 0) + 1
    this._randomRequestToken = requestToken
    var loadingKey = append ? "loadingNext" : "loading"
    this.setData({ [loadingKey]: true, loadError: false, errorText: "" })
    try {
      var card = await this._fetchRandomCard(requestToken)
      if (requestToken !== this._randomRequestToken || !this._readerAlive || !this.readerSessionValid()) return
      this._applyRandomCard(card, append, requestToken)
    } catch (err) {
      this._handleRandomCardError(err, requestToken, append)
    }
  },

  async _fetchRandomCard(requestToken) {
    var params = { ...this.data.randomParams }
    if (this._excludeIds && this._excludeIds.length) params.exclude_ids = this._excludeIds.join(",")
    var data = await api.request('GET', '/formulas/random/next', params, { auth: 'optional' })
    if (requestToken !== this._randomRequestToken || !this._readerAlive || !this.readerSessionValid()) return
    var card = await this.enrichCard(data || {})
    if (requestToken !== this._randomRequestToken || !this._readerAlive || !this.readerSessionValid()) return
    if (!card || !card.id) throw new Error("没有更多可背诵的公式")
    this._excludeIds = this._excludeIds || []
    this._excludeIds.push(normalizeId(card.id))
    return card
  },

  _applyRandomCard(card, append, requestToken) {
    var cards = append ? (this.data.displayCards || []).concat([card]) : [card]
    if (cards.length > MAX_RANDOM_HISTORY) cards = cards.slice(-MAX_RANDOM_HISTORY)
    var currentIndex = append ? cards.length - 1 : 0
    var patch = { displayCards: cards, currentIndex: currentIndex }
    if (append && this.data.currentCard) {
      this.applyCardTransition(cards[currentIndex], "next", patch)
    } else {
      var self = this
      this.setData(Object.assign({}, patch, { currentCard: cards[currentIndex], loading: false, loadingNext: false, transitionClass: "" }), function() { self.resetReaderScroll(); self.syncNavigationState() })
    }
  },

  _handleRandomCardError(err, requestToken, append) {
    if (requestToken !== this._randomRequestToken || !this._readerAlive || !this.readerSessionValid()) return
    console.error("Failed to load random formula", err)
    if (append) {
      this.setData({ loadingNext: false, transitionClass: "" })
      wx.showToast({ title: "没有更多公式", icon: "none" })
    } else {
      this.setData({ loading: false, loadError: true, errorText: err && err.message ? err.message : "暂时没有可背诵的公式" })
    }
  },

  async _getFavoriteIds() {
    if (!auth.isLoggedIn()) return []
    const owner = storage.ownerFingerprint()
    if (Array.isArray(this._favoriteIds) && this._favoriteIdsOwner === owner) return this._favoriteIds

    try {
      const data = await api.request('GET', '/formulas/favorites/list', { page: 1, page_size: 200 })
      this._favoriteIds = (data && data.items ? data.items : [])
        .map((item) => normalizeId(item.id))
        .filter((id) => id !== null)
      this._favoriteIdsOwner = owner
    } catch (_) {
      this._favoriteIds = []
      this._favoriteIdsOwner = owner
    }
    return this._favoriteIds
  },

  async enrichCard(card) {
    if (!card) return card
    const favoriteIds = await this._getFavoriteIds()
    return {
      ...card,
      graphImageUrl: resolveGraphImageUrl(card),
      graphThumbnailUrl: resolveGraphThumbnailUrl(card),
      studyCardTypeLabel: studyCardTypeLabel(card),
      publishedAtChina: formatChinaDateTime(card.published_at || card.publishedAt),
      createdAtChina: formatChinaDateTime(card.created_at || card.createdAt),
      updatedAtChina: formatChinaDateTime(card.updated_at || card.updatedAt),
      isFavorited: Boolean(card.isFavorited || card.is_favorited || favoriteIds.some((id) => sameId(id, normalizeId(card.id)))),
    }
  },

  resetReaderScroll() {
    if (!this._readerAlive) return
    this._readerScrollOffset = 0
    this.refineReaderViewport()
    this.setData({ readerScrollTop: 1 }, () => {
      if (this._readerAlive) this.setData({ readerScrollTop: 0 })
    })
  },

  onFormulaReadingChange(event) {
    this.setData({ formulaReadingExpanded: Boolean(event.detail && event.detail.expanded) })
  },

  onFormulaGestureStart() {
    if (this._readerAlive === false || this._readerVisible === false) return
    clearTimeout(this._formulaGestureTimer)
    this._formulaGestureActive = true
    this._readerGesture = null
  },

  onFormulaGestureEnd() {
    if (this._readerAlive === false || this._readerVisible === false) return
    clearTimeout(this._formulaGestureTimer)
    this._formulaGestureTimer = setTimeout(() => {
      if (this._readerAlive === false || this._readerVisible === false) return
      this._formulaGestureActive = false
    }, 70)
  },

  onReaderTouchStart(e = {}) {
    this._readerGesture = null
    if (this.data.loadingNext || this.data.formulaReadingExpanded || this._formulaGestureActive) return
    if (!e.touches || e.touches.length !== 1) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this._readerGesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      dx: 0,
      dy: 0,
      startedAt: Date.now(),
    }
  },

  onReaderTouchMove(e = {}) {
    if (this._formulaGestureActive || !e.touches || e.touches.length !== 1) {
      this._readerGesture = null
      return
    }
    const gesture = this._readerGesture
    const touch = e.touches && e.touches[0]
    if (!gesture || !touch) return
    gesture.dx = touch.clientX - gesture.startX
    gesture.dy = touch.clientY - gesture.startY
  },

  onReaderTouchEnd(e = {}) {
    const gesture = this._readerGesture
    this._readerGesture = null
    if (this._formulaGestureActive || !gesture || this.data.loadingNext || this.data.formulaReadingExpanded) return

    const touch = e.changedTouches && e.changedTouches[0]
    if (touch) {
      gesture.dx = touch.clientX - gesture.startX
      gesture.dy = touch.clientY - gesture.startY
    }
    const horizontalDistance = Math.abs(gesture.dx)
    const verticalDistance = Math.abs(gesture.dy)
    const elapsed = Math.max(1, Date.now() - Number(gesture.startedAt || Date.now()))
    const hasReliableDistance = horizontalDistance >= READER_SWIPE_MIN_DISTANCE
    const isFastFlick = horizontalDistance >= READER_SWIPE_FLICK_MIN_DISTANCE &&
      horizontalDistance / elapsed >= READER_SWIPE_FLICK_VELOCITY
    if ((!hasReliableDistance && !isFastFlick) ||
        horizontalDistance < verticalDistance * READER_SWIPE_HORIZONTAL_DOMINANCE) return

    if (gesture.dx < 0) this.goNext()
    else this.goPrev()
  },

  onReaderTouchCancel() {
    this._readerGesture = null
  },

  onReaderScroll(event = {}) {
    this._readerScrollOffset = Math.max(0, Number(event.detail && event.detail.scrollTop) || 0)
  },

  switchRandomCard(nextIndex, direction) {
    const cards = Array.isArray(this.data.displayCards) ? this.data.displayCards : []
    const card = cards[nextIndex]
    if (!card) return
    this.setData({ loadingNext: true })
    this.applyCardTransition(card, direction, { currentIndex: nextIndex })
  },

  goPrev() {
    if (this.data.loadingNext || this.data.formulaReadingExpanded || !this.readerSessionValid() || !this.data.canGoPrev) return
    if (this.data.isRandom) {
      this.switchRandomCard(this.data.currentIndex - 1, 'prev')
      return
    }

    const ids = Array.isArray(this.data.sequenceIds) ? this.data.sequenceIds : []
    const sequenceIndex = this.data.sequenceIndex - 1
    const formulaId = ids[sequenceIndex]
    if (formulaId !== null && formulaId !== undefined) {
      this.loadCard(formulaId, { transition: true, sequenceIndex, direction: 'prev' })
    } else if (this.data.sequenceHasPrev) this.extendSequence('prev')
  },

  goNext() {
    if (this.data.loadingNext || this.data.formulaReadingExpanded || !this.readerSessionValid() || !this.data.canGoNext) return
    if (!this.data.isRandom) {
      const ids = Array.isArray(this.data.sequenceIds) ? this.data.sequenceIds : []
      const sequenceIndex = this.data.sequenceIndex + 1
      const formulaId = ids[sequenceIndex]
      if (formulaId !== null && formulaId !== undefined) {
        this.loadCard(formulaId, { transition: true, sequenceIndex, direction: 'next' })
      } else if (this.data.sequenceHasNext) this.extendSequence('next')
      return
    }

    const cards = Array.isArray(this.data.displayCards) ? this.data.displayCards : []
    const nextIndex = this.data.currentIndex + 1
    if (nextIndex < cards.length) {
      this.switchRandomCard(nextIndex, 'next')
      return
    }
    this.loadRandomCard({ append: true })
  },

  async toggleFavorite(e) {
    if (!auth.isLoggedIn() || !this.readerSessionValid()) return

    const cardId = normalizeId(e.currentTarget.dataset.id)
    if (cardId === null || this.data.favoriteBusy) return

    const cards = this.data.displayCards.map((item) => ({ ...item }))
    const cardIndex = cards.findIndex((item) => sameId(normalizeId(item.id), cardId))
    if (cardIndex < 0) return

    const card = cards[cardIndex]
    const wasFavorited = Boolean(card.isFavorited)
    this.setData({ favoriteBusy: true })

    try {
      if (wasFavorited) await api.request('DELETE', `/formulas/${cardId}/favorite`)
      else await api.request('PUT', `/formulas/${cardId}/favorite`)
      if (!this._readerAlive || !this.readerSessionValid()) return

      card.isFavorited = !wasFavorited
      cards[cardIndex] = card
      this._favoriteIds = this._favoriteIds || []
      this._favoriteIds = wasFavorited
        ? this._favoriteIds.filter((id) => !sameId(id, cardId))
        : this._favoriteIds.filter((id) => !sameId(id, cardId)).concat([cardId])

      this.setData({
        displayCards: cards,
        currentCard: cards[this.data.currentIndex] || card,
        favoriteBusy: false,
      })
      wx.showToast({ title: wasFavorited ? '已取消收藏' : '已收藏', icon: 'none' })
    } catch (err) {
      if (!this._readerAlive || !this.readerSessionValid()) return
      console.error('Toggle favorite failed', err)
      this.setData({ favoriteBusy: false })
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    }
  },

  retryLoad() {
    if (this.data.isRandom) this.loadRandomCard({ append: false })
    else if (this.data.formulaId !== null) this.loadCard(this.data.formulaId)
  },
})

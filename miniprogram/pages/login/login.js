const auth = require('../../utils/auth')
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const privacy = require('../../utils/privacy')
const config = require('../../config')
const { getNavigationMetrics } = require('../../utils/navigation')
const { createLoginResume } = require('../../utils/launch-resume')
const { userId: resumeOwnerId } = require('../../utils/launch-session-store')

Page({
  data: {
    loading: false,
    error: '',
    showDevLogin: false,
    agreed: false,
    accountMode: false,
    accountEmail: '',
    accountHasWechat: false,
    loginMethod: 'wechat',
    email: '',
    emailCode: '',
    emailChallengeId: '',
    emailCodeSentTo: '',
    emailResendRemaining: 0,
    emailResendLabel: '',
    focusedField: '',
    entryPending: true,
    discMotionActive: false,
    navHeight: 88,
    statusBarHeight: 20,
    navContentHeight: 44,
    navRightPadding: 116,
  },

  _pageDestroyed: false,
  _pageVisible: false,
  _homeRedirectTimer: null,
  _pendingHomeRedirect: false,
  _homeRedirectResolving: false,
  _loginAttemptSeq: 0,
  _loginCancelled: false,
  _emailCountdownTimer: null,
  _emailResendAt: 0,

  onLoad(options) {
    this._launchResume = createLoginResume()
    const redirect = String((options && options.redirect) || '')
    this._sourceUrl = /^\/(?:pages|subpackages)\/[a-zA-Z0-9/_-]+(?:\?[^#]*)?$/.test(redirect) &&
      !redirect.startsWith('/pages/login/login') ? redirect : ''
    this._pageDestroyed = false
    // onLoad is immediately followed by onShow on first entry. Mark the page
    // visible now so a direct-login redirect can be scheduled without relying
    // on lifecycle ordering details across base-library versions.
    this._pageVisible = true
    this._emailResendAt = 0
    this.setData(getNavigationMetrics())

    // Automatic auth invalidation intentionally preserves the current privacy
    // acceptance. Restore that state into the checkbox so returning users are
    // not asked to consent again after a token refresh/login boundary.
    const agreed = privacy.hasAcceptedCurrentPrivacy()
    this._returnOnSuccess = this._hasReturnTarget()
    const accountMode = options && options.mode === 'account' && auth.isLoggedIn()
    if (accountMode) {
      this._accountOwner = resumeOwnerId()
      this._safeSetData({ accountMode: true, agreed, entryPending: false })
      this._applyAccountUser(auth.getUser())
      void auth.syncCurrentUser().then(user => {
        if (!this._pageDestroyed && resumeOwnerId() === this._accountOwner) this._applyAccountUser(user)
      }).catch(error => this._safeSetData({ error: this._loginErrorMessage(error, '账号信息加载失败，请重试') }))
      return
    }
    this.setData({ agreed, entryPending: auth.isLoggedIn() && agreed })

    // 同步检查：token 有效且协议已同意时延迟跳转
    if (this._tryDirectRedirect()) return
    // No stored session: show the login form. wx.login is only called from an
    // explicit tap so first-time visitors can browse the home page instead.
    this._safeSetData({ entryPending: false })
  },

  onShow() {
    this._pageVisible = true
    this._safeSetData({ discMotionActive: true })
    this._syncEmailCountdown()
    if (this._pendingHomeRedirect) {
      this._scheduleHomeRedirect(0)
    }
  },

  onHide() {
    this._pageVisible = false
    this._safeSetData({ discMotionActive: false })
    this._clearHomeRedirectTimer()
    this._clearEmailCountdown()
  },

  onUnload() {
    this._pageDestroyed = true
    this._pageVisible = false
    this._pendingHomeRedirect = false
    this._loginAttemptSeq += 1
    this._clearHomeRedirectTimer()
    this._clearEmailCountdown()
  },

  _safeSetData(data, callback) {
    if (this._pageDestroyed) return
    this.setData(data, callback)
  },

  _hasReturnTarget() {
    try {
      const pages = getCurrentPages()
      return Boolean(pages && pages.length > 1)
    } catch (_) {
      return false
    }
  },

  _clearHomeRedirectTimer() {
    if (this._homeRedirectTimer) {
      clearTimeout(this._homeRedirectTimer)
      this._homeRedirectTimer = null
    }
  },

  _clearEmailCountdown() {
    if (this._emailCountdownTimer) {
      clearInterval(this._emailCountdownTimer)
      this._emailCountdownTimer = null
    }
  },

  _syncEmailCountdown() {
    if (!this._emailResendAt) {
      this._safeSetData({ emailResendRemaining: 0, emailResendLabel: '' })
      return
    }
    const remaining = Math.max(0, Math.ceil((this._emailResendAt - Date.now()) / 1000))
    this._safeSetData({
      emailResendRemaining: remaining,
      emailResendLabel: remaining > 0 ? `${remaining} 秒后可重发` : '重新发送',
    })
    if (remaining <= 0) {
      this._emailResendAt = 0
      this._clearEmailCountdown()
      return
    }
    if (!this._emailCountdownTimer && this._pageVisible) {
      this._emailCountdownTimer = setInterval(() => this._syncEmailCountdown(), 1000)
    }
  },

  _startEmailCountdown(seconds) {
    const delay = Math.max(0, Number(seconds) || 0)
    this._clearEmailCountdown()
    this._emailResendAt = Date.now() + delay * 1000
    this._syncEmailCountdown()
  },

  _clearEmailChallenge() {
    this._clearEmailCountdown()
    this._emailResendAt = 0
    this._safeSetData({
      emailChallengeId: '',
      emailCodeSentTo: '',
      emailCode: '',
      emailResendRemaining: 0,
      emailResendLabel: '',
    })
  },

  _scheduleHomeRedirect(delayMs = 0) {
    if (this._pageDestroyed) return
    this._pendingHomeRedirect = true
    this._clearHomeRedirectTimer()
    if (!this._pageVisible) return
    this._safeSetData({ entryPending: true })

    this._homeRedirectTimer = setTimeout(async () => {
      this._homeRedirectTimer = null
      if (this._pageDestroyed || !this._pageVisible) return

      // A delayed redirect must re-check the session. This prevents a stale
      // timer from entering Home after auth/privacy state changed meanwhile.
      if (!auth.isLoggedIn() || !privacy.hasAcceptedCurrentPrivacy()) {
        this._pendingHomeRedirect = false
        this._safeSetData({ entryPending: false })
        return
      }

      await this._redirectAfterLogin()
    }, Math.max(0, Number(delayMs) || 0))
  },

  async _redirectAfterLogin() {
    if (this._homeRedirectResolving) return
    this._homeRedirectResolving = true
    const owner = resumeOwnerId()
    const attemptSeq = this._loginAttemptSeq
    if (!await auth.checkAndRefreshToken()) {
      this._homeRedirectResolving = false
      this._pendingHomeRedirect = false
      this._safeSetData({ entryPending: false })
      return
    }
    if (this._pageDestroyed || !this._pageVisible) {
      this._homeRedirectResolving = false
      return
    }
    if (owner !== resumeOwnerId() || attemptSeq !== this._loginAttemptSeq ||
      !auth.isLoggedIn() || !privacy.hasAcceptedCurrentPrivacy()) {
      this._homeRedirectResolving = false
      this._pendingHomeRedirect = false
      this._safeSetData({ entryPending: false })
      return
    }
    if (this._returnOnSuccess && this._hasReturnTarget()) {
      // Arrived from a page's cancellable login prompt: return there instead of
      // replaying the write action the user originally attempted.
      this._pendingHomeRedirect = false
      this._homeRedirectResolving = false
      this._safeSetData({ entryPending: false })
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
      return
    }
    if (this._sourceUrl) {
      this._pendingHomeRedirect = false
      this._homeRedirectResolving = false
      wx.reLaunch({
        url: this._sourceUrl,
        fail: () => this._safeSetData({
          entryPending: false, loading: false, error: '返回页面失败，可暂不登录返回首页',
        }),
      })
      return
    }
    let target
    try {
      target = await this._launchResume.resolve()
    } catch (_) {
      this._pendingHomeRedirect = false
      this._safeSetData({ entryPending: false, loading: false, error: '进入页面失败，请重试' })
      return
    } finally {
      this._homeRedirectResolving = false
    }
    if (this._pageDestroyed || !this._pageVisible) return
    if (attemptSeq !== this._loginAttemptSeq) {
      if (!this.data.loading) this._scheduleHomeRedirect(0)
      return
    }
    if (!target || !auth.isLoggedIn() || !privacy.hasAcceptedCurrentPrivacy() ||
      owner !== resumeOwnerId()) {
      this._pendingHomeRedirect = false
      this._safeSetData({ entryPending: false })
      return
    }
    this._pendingHomeRedirect = false
    wx.reLaunch({
      url: target,
      success: () => this._launchResume.complete(),
      fail: () => {
        if (this._pageDestroyed) return
        this._safeSetData({ entryPending: false, loading: false, error: '进入页面失败，请重试' })
      },
    })
  },

  /** 同步检查 storage 中的 token 和协议同意状态 */
  _tryDirectRedirect() {
    const token = storage.get(storage.KEYS.TOKEN)
    const rawExpiresAt = storage.get(storage.KEYS.TOKEN_EXPIRES_AT)
    if (!token) return false
    // 协议版本已升级或未同意 → 留在登录页
    if (!privacy.hasAcceptedCurrentPrivacy()) {
      return false
    }
    if (rawExpiresAt === null || rawExpiresAt === undefined || rawExpiresAt === '') {
      this._scheduleHomeRedirect(100)
      return true
    }

    const expiresAt = api.normalizeExpiresAt(rawExpiresAt)
    if (!expiresAt) {
      // Corrupted/legacy expiry metadata should go through the async validator
      // instead of being treated as an indefinitely valid token.
      return false
    }
    const tte = expiresAt - Math.floor(api.now() / 1000)
    if (tte > 86400) {
      this._scheduleHomeRedirect(100)
      return true
    }
    // Token 需要刷新 → 走 async 链路
    return false
  },

  _isCurrentAttempt(attemptSeq) {
    return !this._pageDestroyed && attemptSeq === this._loginAttemptSeq
  },

  _applyAccountUser(user) {
    const identities = (user && user.identities) || []
    const email = identities.find(identity => identity.provider === 'email')
    const hasWechat = identities.some(identity => identity.provider === 'wechat')
    this._safeSetData({
      accountEmail: (user && user.email) || (email && email.masked_subject) || '',
      accountHasWechat: hasWechat,
      loginMethod: email && !hasWechat ? 'wechat' : 'email',
    })
  },

  _assertAccountOwner() {
    if (this.data.accountMode && (!auth.isLoggedIn() || resumeOwnerId() !== this._accountOwner)) {
      throw new Error('账号已切换，请重新进入账号与登录')
    }
  },

  _savePrivacyAfterLogin() {
    try {
      privacy.savePrivacyAcceptance(['user_agreement', 'privacy_policy', 'ai_service'])
    } catch (_) {
      // Authentication + consent must be committed as one logical state. If
      // strict storage of the consent record fails (for example storage is
      // full), roll back the auth session rather than leaving a hidden logged-
      // in state while the page reports a login failure.
      storage.clearSession({ preservePrivacyAcceptance: true, includeDebugSnapshots: false })
      throw new Error('协议确认记录保存失败，请清理存储空间后重试')
    }
  },

  _loginErrorMessage(error, fallback) {
    if (error && typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim()
    }
    const errMsg = error && typeof error.errMsg === 'string' ? error.errMsg : ''
    if (errMsg.indexOf('login') >= 0 || errMsg.indexOf('network') >= 0) {
      return '微信登录失败，请检查网络后重试'
    }
    return fallback || '登录失败，请稍后重试'
  },

  onGuestBrowse() {
    if (this._pageDestroyed) return
    this._loginCancelled = true
    this._pendingHomeRedirect = false
    this._clearHomeRedirectTimer()
    this._loginAttemptSeq += 1
    try {
      if (this._hasReturnTarget()) {
        wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/home' }) })
      } else {
        wx.reLaunch({ url: '/pages/home/home' })
      }
    } catch (_) {
      wx.reLaunch({ url: '/pages/home/home' })
    }
  },

  onAgreementChange(e) {
    if (this.data.loading) return
    const values = e && e.detail && Array.isArray(e.detail.value) ? e.detail.value : []
    const agreed = values.includes('agreed')
    this.setData({ agreed })
    // 不在此处保存协议记录，仅在登录成功后保存
  },

  onLoginMethodChange(e) {
    if (this.data.loading) return
    const method = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.method
      : ''
    if (method !== 'wechat' && method !== 'email') return
    this._safeSetData({ loginMethod: method, error: '' })
  },

  onEmailInput(e) {
    if (this.data.loading) return
    const email = String((e && e.detail && e.detail.value) || '').slice(0, 254)
    if (this.data.emailChallengeId && email.trim() !== this.data.emailCodeSentTo) {
      this._clearEmailChallenge()
    }
    this._safeSetData({ email, error: '' })
  },

  onEmailCodeInput(e) {
    if (this.data.loading) return
    const emailCode = String((e && e.detail && e.detail.value) || '')
      .replace(/\D/g, '')
      .slice(0, 6)
    this._safeSetData({ emailCode, error: '' })
  },

  onLoginFieldFocus(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.field
      : ''
    if (field) this._safeSetData({ focusedField: field })
  },

  onLoginFieldBlur(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.field
      : ''
    if (!field || field === this.data.focusedField) {
      this._safeSetData({ focusedField: '' })
    }
  },

  openAgreement(e) {
    const type = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.type
      : ''
    const pathMap = {
      user: '/pages/agreement/user',
      privacy: '/pages/agreement/privacy',
      ai: '/pages/agreement/ai',
    }
    const url = pathMap[type]
    if (!url) return
    wx.navigateTo({ url })
  },

  ensureAgreementAccepted() {
    if (this.data.accountMode || this.data.agreed) return true
    wx.showToast({ title: '请先阅读并同意相关协议', icon: 'none' })
    return false
  },

  _validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  },

  _getWechatLoginCode() {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, result) => {
        if (settled) return
        settled = true
        if (error) {
          reject(error)
          return
        }
        resolve(result || {})
      }
      try {
        const pending = wx.login({
          success: result => finish(null, result),
          fail: error => finish(error),
        })
        if (pending && typeof pending.then === 'function') {
          pending.then(result => finish(null, result), error => finish(error))
        }
      } catch (error) {
        finish(error)
      }
    })
  },

  async _startEmailOtp() {
    if (this._pageDestroyed || this.data.loading || this.data.emailResendRemaining > 0) {
      return
    }
    if (!this.ensureAgreementAccepted()) return
    const email = this.data.email.trim()
    if (!this._validEmail(email)) {
      this._safeSetData({ error: '请输入有效的邮箱地址' })
      return
    }

    const attemptSeq = ++this._loginAttemptSeq
    this._loginCancelled = false
    this._safeSetData({ loading: true, error: '' })
    try {
      this._assertAccountOwner()
      let wechatCode = ''
      if (!this.data.accountMode) {
        const loginResult = await this._getWechatLoginCode()
        if (!this._isCurrentAttempt(attemptSeq) || this._loginCancelled) return
        wechatCode = String(loginResult.code || '')
        if (!wechatCode) throw new Error('微信客户端校验失败，请重试')
      }
      if (!this._isCurrentAttempt(attemptSeq) || this._loginCancelled) return
      this._assertAccountOwner()
      const response = await api.post(this.data.accountMode
        ? '/users/me/identities/email/bind/start' : '/auth/email/start', this.data.accountMode ? { email } : {
        email,
        wechat_code: wechatCode,
        client: 'miniprogram',
        accepted_terms: true,
        agreement_version: config.AGREEMENT_VERSION,
        privacy_version: config.PRIVACY_POLICY_VERSION,
      }, this.data.accountMode ? {} : { auth: 'none' })
      if (!this._isCurrentAttempt(attemptSeq) || this._loginCancelled) return
      this._assertAccountOwner()
      this._safeSetData({
        email,
        emailChallengeId: response.challenge_id,
        emailCodeSentTo: email,
        emailCode: '',
        loading: false,
      })
      this._startEmailCountdown(response.resend_after)
      wx.showToast({ title: '验证码已发送', icon: 'none' })
    } catch (e) {
      if (this._pageDestroyed) return
      this._safeSetData({
        loading: false,
        error: this._loginErrorMessage(e, '验证码发送失败，请稍后重试'),
      })
    }
  },

  async onEmailSubmit() {
    if (this._pageDestroyed || this.data.loading) return
    if (!this.data.emailChallengeId) {
      await this._startEmailOtp()
      return
    }
    if (!this.ensureAgreementAccepted()) return
    if (this.data.emailCode.length !== 6) {
      wx.showToast({ title: '请输入 6 位验证码', icon: 'none' })
      return
    }

    const attemptSeq = ++this._loginAttemptSeq
    this._loginCancelled = false
    this._safeSetData({ loading: true, error: '' })
    try {
      this._assertAccountOwner()
      const data = await api.post(this.data.accountMode
        ? '/users/me/identities/email/bind/verify' : '/auth/email/verify', {
        challenge_id: this.data.emailChallengeId,
        code: this.data.emailCode,
        client: 'miniprogram',
      }, this.data.accountMode ? {} : { auth: 'none' })
      if (!this._isCurrentAttempt(attemptSeq)) return
      this._assertAccountOwner()
      auth.loginDirect(data.access_token, data.user, data.expires_at, data.refresh_token)
      if (!this.data.accountMode) this._savePrivacyAfterLogin()
      api.resetRedirecting()
      this._clearEmailChallenge()
      this._safeSetData({ loading: false })
      this._scheduleHomeRedirect(0)
    } catch (e) {
      if (!this._isCurrentAttempt(attemptSeq)) return
      this._safeSetData({
        entryPending: false,
        error: this._loginErrorMessage(e, '邮箱登录失败，请稍后重试'),
      })
    } finally {
      if (this._isCurrentAttempt(attemptSeq) && this.data.loading) {
        this._safeSetData({ loading: false })
      }
    }
  },

  async onEmailResend() {
    if (this.data.loading || this.data.emailResendRemaining > 0) return
    await this._startEmailOtp()
  },

  async onWechatLogin() {
    if (this._pageDestroyed || this.data.loading) return
    if (!this.ensureAgreementAccepted()) return
    const attemptSeq = ++this._loginAttemptSeq
    this._loginCancelled = false
    this._safeSetData({ loading: true, error: '' })
    try {
      if (this.data.accountMode) {
        this._assertAccountOwner()
        const { code } = await wx.login()
        if (!this._isCurrentAttempt(attemptSeq) || this._loginCancelled) return
        this._assertAccountOwner()
        if (!code) throw new Error('微信授权失败，请重试')
        const data = await api.post('/users/me/identities/wechat/bind', { code, client: 'miniprogram' })
        if (!this._isCurrentAttempt(attemptSeq) || this._loginCancelled) return
        this._assertAccountOwner()
        auth.loginDirect(data.access_token, data.user, data.expires_at, data.refresh_token)
      } else {
        await auth.wechatLogin({ shouldCommit: () => !this._loginCancelled })
      }
      if (this._loginCancelled) return
      // auth.wechatLogin commits auth first, so always finish the consent commit
      // (or roll auth back) before any lifecycle-based early return.
      if (!this.data.accountMode) this._savePrivacyAfterLogin()
      api.resetRedirecting()
      if (!this._isCurrentAttempt(attemptSeq)) return
      this._safeSetData({ loading: false })
      this._scheduleHomeRedirect(0)
    } catch (e) {
      if (!this._isCurrentAttempt(attemptSeq)) return
      this._safeSetData({ entryPending: false, error: this._loginErrorMessage(e, '登录失败，请稍后重试') })
    } finally {
      if (this._isCurrentAttempt(attemptSeq) && this.data.loading) {
        this._safeSetData({ loading: false })
      }
    }
  },

  async onDevLogin() {
    if (this._pageDestroyed || this.data.loading) return
    if (!this.ensureAgreementAccepted()) return
    const attemptSeq = ++this._loginAttemptSeq
    this._safeSetData({ loading: true, error: '' })
    try {
      const loginResult = await wx.login()
      if (!this._isCurrentAttempt(attemptSeq)) return
      const code = loginResult && loginResult.code
      if (!code) throw new Error('微信登录失败，请重试')

      const data = await api.post('/auth/login', { code })
      if (!this._isCurrentAttempt(attemptSeq)) return
      auth.loginDirect(data.access_token, data.user, data.expires_at, data.refresh_token)
      this._savePrivacyAfterLogin()
      api.resetRedirecting()
      this._safeSetData({ loading: false })
      this._scheduleHomeRedirect(0)
    } catch (e) {
      if (!this._isCurrentAttempt(attemptSeq)) return
      this._safeSetData({ entryPending: false, error: this._loginErrorMessage(e, '开发模式登录失败，请确保后端已启动') })
    } finally {
      if (this._isCurrentAttempt(attemptSeq) && this.data.loading) {
        this._safeSetData({ loading: false })
      }
    }
  },
})

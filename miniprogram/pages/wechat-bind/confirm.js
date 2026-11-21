const api = require('../../utils/api')

function normalizeChallenge(value) {
  const challenge = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(challenge)) return ''
  return challenge
}

function parseScene(options) {
  const raw = options && (options.scene || options.challenge)
  let value = raw
  try {
    value = decodeURIComponent(String(raw || ''))
  } catch (_) {
    value = raw
  }
  return normalizeChallenge(value)
}

Page({
  data: {
    challenge: '',
    manualChallenge: '',
    confirming: false,
    result: '',
    error: '',
  },

  onLoad(options) {
    const challenge = parseScene(options)
    this.setData({ challenge })
  },

  onManualChallengeInput(event) {
    this.setData({
      manualChallenge: event.detail.value,
      error: '',
    })
  },

  applyManualChallenge() {
    const challenge = normalizeChallenge(this.data.manualChallenge)
    if (!challenge) {
      this.setData({ error: '绑定码格式不正确' })
      return
    }
    this.setData({ challenge, error: '', result: '' })
  },

  async confirmBind() {
    if (this.data.confirming) return
    const challenge = normalizeChallenge(this.data.challenge)
    if (!challenge) {
      this.setData({ error: '请先扫码或输入绑定码' })
      return
    }
    this.setData({ confirming: true, error: '', result: '' })
    try {
      const login = await wx.login()
      if (!login.code) throw new Error('微信身份验证失败，请重试')
      const result = await api.post(
        '/auth/wechat/bind/confirm',
        {
          challenge_id: challenge,
          code: login.code,
        },
        { auth: 'none', suppressNetworkToast: true },
      )
      if (!result || result.status !== 'completed') {
        throw new Error(result && result.message ? result.message : '绑定未完成')
      }
      this.setData({
        result: result.message || '微信已绑定，请回到网页重新登录',
      })
    } catch (error) {
      this.setData({
        error: api.getErrorMessage(error) || '绑定未完成，请回到网页重新生成绑定码',
      })
    } finally {
      this.setData({ confirming: false })
    }
  },

  returnHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  },
})

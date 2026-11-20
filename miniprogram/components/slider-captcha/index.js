const api = require('../../utils/api')

function offsetFrom(event, maximum) {
  return Math.round(Math.max(0, Math.min(maximum, Number(event.detail.value) || 0)))
}

function appendPoint(points, point) {
  if (points.length >= 64) {
    const retained = points.filter((_, index) => index === 0 || index % 2 === 1)
    points.splice(0, points.length, ...retained)
  }
  points.push(point)
}

Component({
  data: {
    loading: true,
    verifying: false,
    challenge: null,
    maximum: 272,
    value: 0,
    pieceLeft: 0,
    pieceTop: 0,
    pieceWidth: 15,
    pieceHeight: 30,
    error: '',
  },
  lifetimes: {
    attached() {
      this._active = true
      this._requestSeq = 0
      void this.loadChallenge()
    },
    detached() {
      this._active = false
      this._requestSeq += 1
    },
  },
  methods: {
    _resetMotion() {
      this._startedAt = 0
      this._points = [{ x: 0, y: 0, t: 0 }]
    },

    async loadChallenge() {
      const seq = ++this._requestSeq
      this._resetMotion()
      this.setData({ loading: true, verifying: false, challenge: null, value: 0, pieceLeft: 0, error: '' })
      try {
        const challenge = await api.post('/auth/captcha/slider/start', {}, { auth: 'none' })
        if (!this._active || seq !== this._requestSeq) return
        this.setData({
          challenge,
          maximum: challenge.width - challenge.piece_size,
          pieceTop: challenge.piece_y / challenge.height * 100,
          pieceWidth: challenge.piece_size / challenge.width * 100,
          pieceHeight: challenge.piece_size / challenge.height * 100,
        })
      } catch (error) {
        if (this._active && seq === this._requestSeq) this.setData({ error: api.getErrorMessage(error) })
      } finally {
        if (this._active && seq === this._requestSeq) this.setData({ loading: false })
      }
    },

    onRefresh() {
      if (!this.data.loading && !this.data.verifying) return this.loadChallenge()
    },

    onCancel() {
      this._active = false
      this._requestSeq += 1
      this.triggerEvent('cancel')
    },

    onTouchStart() {
      if (this.data.loading || this.data.verifying) return
      this._resetMotion()
      this._startedAt = Date.now()
    },

    onTouchCancel() {
      this._resetMotion()
      this.setData({ value: 0, pieceLeft: 0 })
    },

    _record(value) {
      if (!this._startedAt) this._startedAt = Date.now()
      const point = { x: value, y: 0, t: Date.now() - this._startedAt }
      const previous = this._points[this._points.length - 1]
      if (Math.abs(previous.x - point.x) >= 2 || point.t - previous.t >= 80) {
        appendPoint(this._points, point)
      }
      this.setData({ value, pieceLeft: value / this.data.challenge.width * 100, error: '' })
      return point
    },

    onChanging(event) {
      if (!this.data.challenge || this.data.loading || this.data.verifying) return
      this._record(offsetFrom(event, this.data.maximum))
    },

    async onChange(event) {
      if (!this._active || !this.data.challenge || this.data.loading || this.data.verifying) return
      const value = offsetFrom(event, this.data.maximum)
      const finalPoint = this._record(value)
      if (value < 8 || finalPoint.t < 180) {
        this._resetMotion()
        this.setData({ value: 0, pieceLeft: 0, error: '请慢慢拖动拼图对齐缺口' })
        return
      }
      appendPoint(this._points, finalPoint)
      const seq = this._requestSeq
      this.setData({ verifying: true })
      try {
        const result = await api.post('/auth/captcha/slider/verify', {
          captcha_id: this.data.challenge.captcha_id,
          offset: value,
          trajectory: this._points,
        }, { auth: 'none' })
        if (!this._active || seq !== this._requestSeq) return
        this._active = false
        this.triggerEvent('verified', { ticket: result.ticket })
      } catch (error) {
        if (!this._active || seq !== this._requestSeq) return
        this._resetMotion()
        this.setData({ value: 0, pieceLeft: 0, error: api.getErrorMessage(error) })
      } finally {
        if (this._active && seq === this._requestSeq) this.setData({ verifying: false })
      }
    },
  },
})

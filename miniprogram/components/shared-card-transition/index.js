const navigation = require('../../utils/shared-card-navigation')
Component({
  properties: {
    transitionKey: { type: String, value: '', observer: 'start' },
  },
  data: { visible: false, title: '', command: null },
  lifetimes: {
    attached() { this._alive = true; this.start(this.properties.transitionKey) },
    detached() { this._alive = false; this._leave = null; this._cancelLeave = null; this.clearFallback() },
  },
  pageLifetimes: {
    hide() { this.cancel() },
    resize() { this.cancel() },
  },
  methods: {
    start(key) {
      if (!this._alive) return
      if (!key) return this.cancel()
      if (key === this._key) return
      this._key = key
      this._origin = navigation.take(key)
      if (!this._origin) return
      const info = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375, windowHeight: 667 }
      this._arrived = false
      this.setData({ visible: true, title: this._origin.title, command: {
        active: true, origin: this._origin.rect, width: info.windowWidth,
        height: info.windowHeight, close: false,
      } })
      // Navigation and content remain usable when a client has no WXS rAF.
      this._fallback = setTimeout(() => this.arrived(), 560)
    },
    arrived() { if (this._arrived || !this._alive || this._leave || !this.data.visible) return; this.clearFallback(); this._arrived = true; this.revealContent() },
    revealContent() {
      if (!this._alive || !this._arrived || !this.data.visible || this._leave) return
      // Slow requests reveal the page's existing loading UI, never a blank cover.
      this.setData({ command: { ...this.data.command, reveal: true } })
      this.clearFallback()
      this._fallback = setTimeout(() => this.revealed(), 160)
    },
    revealed() {
      if (!this._alive || this._leave || !this.data.command.active || this.data.command.close) return
      this.clearFallback()
      this.setData({ visible: false })
    },
    leave(callback, cancelled) {
      if (!this._origin || !this._alive) return false
      this._leave = callback
      this._cancelLeave = cancelled
      this.setData({ visible: true, command: { ...this.data.command, active: true, reveal: false, close: true } })
      this.clearFallback()
      this._fallback = setTimeout(() => this.departed(), 560)
      return true
    },
    departed() {
      const callback = this._leave
      this.clearFallback()
      this._leave = null
      this._cancelLeave = null
      if (this._alive && callback) callback()
    },
    clearFallback() { clearTimeout(this._fallback); this._fallback = null },
    cancel() {
      const cancelled = this._cancelLeave
      this.clearFallback()
      this._origin = null
      this._leave = null
      this._cancelLeave = null
      this.setData({ command: { active: false }, visible: false })
      if (cancelled) cancelled()
    },
  },
})

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    closing: { type: Boolean, value: false },
    anchor: { type: String, value: '' },
    label: { type: String, value: '选择科目' },
    variant: { type: String, value: 'slide' },
    background: { type: String, value: '#FBFFFD' },
    layer: { type: Number, value: 160 },
    safeArea: { type: Boolean, value: true },
    contentMotion: { type: String, value: 'slide' },
    dismissible: { type: Boolean, value: true },
  },
  data: { rendered: false, measuring: false, command: null },
  observers: {
    'show, closing': function () { if (this._attached) this.syncVisibility() },
    dismissible(value) {
      if (this._attached && this.data.command && this.data.command.active) {
        const recover = value === false && this.properties.show && !this.properties.closing
        if (recover) { this.clearTimers(); this._notifyClose = false; this._sequence++ }
        // A quick save may unlock before y reaches zero; keep that recovery
        // intent until visibility changes instead of cancelling it halfway.
        this.setData({ command: { ...this.data.command, dismissible: value,
          ...(recover ? { id: this._sequence, resume: true, close: false, resetDrag: true } : {}),
        } })
      }
    },
  },
  lifetimes: {
    attached() { this._attached = true; this._sequence = 0; this.syncVisibility() },
    detached() { this._attached = false; this._sequence++; this.clearTimers() },
  },
  pageLifetimes: {
    hide() { this._sequence++; this.clearTimers(); this._notifyClose = false; this.setData({ command: { active: false }, rendered: false }) },
    show() { if (this._attached && this.properties.show) this.syncVisibility() },
    resize() {
      if (!this._attached || !this.properties.show) return
      if (this._closeTimer) this.finishClose({ id: this.data.command && this.data.command.id })
      else this.measure(true)
    },
  },
  methods: {
    syncVisibility() {
      if (!this.properties.show) {
        this._notifyClose = false
        if (this.data.rendered) this.beginClose(false)
      } else if (this.properties.closing) {
        if (this.data.rendered) this.beginClose(false)
      } else if (!this.data.rendered) {
        this.clearTimers()
        this._notifyClose = false
        this.setData({ rendered: true, measuring: true }, () => this.measure(false))
      } else if (this.data.measuring || !this.data.command || !this.data.command.active) {
        this.clearTimers()
        this._notifyClose = false
        this.setData({ measuring: true }, () => this.measure(false))
      } else if (this.data.command && this.data.command.close) {
        this.clearTimers()
        this._notifyClose = false
        this._sequence++
        this.setData({ command: { ...this.data.command, id: this._sequence, close: false, resume: true } })
      }
    },
    measure(immediate) {
      const seq = ++this._sequence
      const query = this.createSelectorQuery()
      query.select('.motion-sheet-shell').boundingClientRect()
      query.exec(rows => {
        if (!this._attached || seq !== this._sequence) return
        if (!rows[0] || !rows[0].height || !rows[0].width) {
          this.setData({ measuring: false, command: null })
          return
        }
        const panel = rows[0]
        const apply = origin => {
          if (!this._attached || seq !== this._sequence || !this.properties.show) return
          const anchored = Boolean(origin && origin.width > 0 && origin.height > 0)
          const dock = this.properties.variant === 'dock' && anchored
          // (1) Dock returns to a small point, never the whole subject row.
          const start = dock ? {
            left: origin.left + origin.width / 2 - 4,
            top: origin.top + origin.height / 2 - 4,
            width: 8, height: 8,
          } : anchored ? origin : { ...panel, top: panel.top + panel.height }
          this.setData({ measuring: false, command: {
            active: true, close: this.properties.closing, id: seq, panel,
            origin: start, dock,
            fade: this.properties.contentMotion === 'fade', anchored, immediate,
            dismissible: this.properties.dismissible,
          } })
          if (this.properties.closing) this.beginClose(false)
        }
        if (!this.properties.anchor) return apply(null)
        wx.createSelectorQuery().select(this.properties.anchor).boundingClientRect(apply).exec()
      })
    },
    clearTimers() { clearTimeout(this._closeTimer); this._closeTimer = null },
    beginClose(notify) {
      if (!this._attached || !this.data.rendered) return
      this._notifyClose = this._notifyClose || notify
      if (this._closeTimer) return
      const id = this.data.command && this.data.command.id !== undefined ? this.data.command.id : this._sequence
      this._closeTimer = setTimeout(() => this.finishClose({ id }), 480)
      if (this.data.command) this.setData({ command: { ...this.data.command, close: true, resetDrag: false } })
      else this.finishClose({ id })
    },
    finishClose(result) {
      const command = this.data.command
      const id = command && command.id !== undefined ? command.id : this._sequence
      if (!this._attached || !this.data.rendered || !result || result.id !== id) return
      const notify = this._notifyClose && this.properties.show
      this.clearTimers()
      this._sequence++
      this._notifyClose = false
      this.setData({ command: { active: false }, rendered: false, measuring: false })
      if (notify) this.triggerEvent('close', { completed: true })
      this.triggerEvent('closed', { completed: true })
    },
    requestClose() { if (!this.properties.closing && this.properties.dismissible) this.beginClose(true) },
    dismissFromGesture(result) {
      // (4) Bridge messages from a hidden or remeasured drawer are obsolete.
      const command = this.data.command
      if (!this._attached || this.properties.dismissible === false || this.properties.closing || !this.data.rendered || !command || !command.active ||
          !result || result.id !== command.id) return
      this._notifyClose = true
      this.finishClose(result)
    },
    noop() {},
  },
})

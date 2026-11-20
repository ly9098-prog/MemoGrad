Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    closing: { type: Boolean, value: false },
    anchor: { type: String, value: '' },
    label: { type: String, value: '选择科目' },
  },
  data: { rendered: false, measuring: false, command: null },
  observers: { 'show, closing': function () { if (this._attached) this.syncVisibility() } },
  lifetimes: {
    attached() { this._attached = true; this._sequence = 0; this.syncVisibility() },
    detached() { this._attached = false; this._sequence++ },
  },
  pageLifetimes: {
    hide() { this._sequence++; this.setData({ command: { active: false }, rendered: false }) },
    show() { if (this._attached && this.properties.show) this.syncVisibility() },
    resize() { if (this._attached && this.properties.show) this.measure(true) },
  },
  methods: {
    syncVisibility() {
      if (!this.properties.show) {
        this._sequence++
        this.setData({ command: { active: false }, rendered: false })
      } else if (this.properties.closing) {
        if (this.data.command) this.setData({ command: { ...this.data.command, close: true } })
      } else if (!this.data.rendered) {
        this.setData({ rendered: true, measuring: true }, () => this.measure(false))
      } else if (this.data.command && this.data.command.close) {
        this.setData({ command: { ...this.data.command, close: false } })
      }
    },
    measure(immediate) {
      const seq = ++this._sequence
      const query = this.createSelectorQuery()
      query.select('.motion-sheet-shell').boundingClientRect()
      query.exec(rows => {
        if (!this._attached || seq !== this._sequence || !rows[0]) return
        const panel = rows[0]
        const apply = origin => {
          if (!this._attached || seq !== this._sequence || !this.properties.show) return
          this.setData({ measuring: false, command: {
            active: true, close: this.properties.closing, id: seq, panel,
            origin: origin && origin.width ? origin : { ...panel, top: panel.top + panel.height },
            immediate,
          } })
        }
        if (!this.properties.anchor) return apply(null)
        wx.createSelectorQuery().select(this.properties.anchor).boundingClientRect(apply).exec()
      })
    },
    requestClose() { if (!this.properties.closing) this.triggerEvent('close') },
    dismissFromGesture(result) {
      // (4) Bridge messages from a hidden or remeasured drawer are obsolete.
      const command = this.data.command
      if (!this._attached || this.properties.closing || !this.data.rendered || !command || !command.active ||
          !result || result.id !== command.id) return
      this._sequence++
      // (4) The physical dismissal is finished; release the hit layer now.
      this.setData({ command: { active: false }, rendered: false })
      this.triggerEvent('close', { completed: true })
    },
    noop() {},
  },
})

Component({
  options: { virtualHost: true },
  externalClasses: ['reader-class'],
  properties: {
    content: { type: null, observer() { this.scheduleMeasure() } },
  },
  data: { contentHeight: 1 },
  lifetimes: {
    attached() { this._attached = true; this._revision = 0; this.scheduleMeasure() },
    detached() { this._attached = false; this._revision++ },
  },
  pageLifetimes: {
    resize() { this.scheduleMeasure() },
    show() { this.scheduleMeasure() },
  },
  methods: {
    scheduleMeasure() {
      if (!this._attached) return
      const revision = ++this._revision
      wx.nextTick(() => {
        if (!this._attached || revision !== this._revision) return
        this.createSelectorQuery().select('.fit-scroll-content').boundingClientRect().exec(rows => {
          if (!this._attached || revision !== this._revision || !rows[0] || !rows[0].width) return
          const contentHeight = Math.max(1, Math.ceil(rows[0].height))
          this.setData({ contentHeight }, () => {
            if (this._attached && revision === this._revision) {
              this.triggerEvent('readerresize', {}, { bubbles: true, composed: true })
            }
          })
        })
      })
    },
  },
})

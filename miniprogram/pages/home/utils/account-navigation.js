const auth = require('../../../utils/auth')

const accountNavigationMethods = {
  openAccountSecurity() {
    if (!auth.isLoggedIn()) return
    wx.navigateTo({ url: '/pages/login/login?mode=account' })
  },
}

module.exports = { accountNavigationMethods }

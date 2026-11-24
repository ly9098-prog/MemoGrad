const assert = require('node:assert/strict')
const { test } = require('node:test')

global.wx = {
  getStorageSync: () => null,
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
}

const { growthPageMethods } = require('../pages/home/utils/growth-page-controller')

test('guest home uses a neutral visitor identity', () => {
  const guest = growthPageMethods._guestBasePatch()
  assert.equal(guest.guestMode, true)
  assert.equal(guest.displayName, '游客')
  assert.equal(guest.userInitial, '游')
})

test('home greeting falls back to 研究生 when the logged-in user has no name', () => {
  assert.equal(growthPageMethods.getDisplayName({}), '研究生')
  assert.equal(growthPageMethods.getDisplayName({ nickname: '   ' }), '研究生')
})

test('home greeting still prefers and limits a configured nickname', () => {
  assert.equal(growthPageMethods.getDisplayName({ nickName: '  Learner  ' }), 'Learner')
  assert.equal(growthPageMethods.getDisplayName({ nickname: '一二三四五六七八九十' }), '一二三四五六七八')
  assert.equal(growthPageMethods.getUserInitial({ nickname: '示例昵称' }), '示')
})

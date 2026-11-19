/**
 * Export preview must never serve a locally cached private file after auth is
 * cleared or a different account signs in while the page remains alive.
 *
 * Run: node tests/test-export-preview-auth-boundary.js
 */
const assert = require('node:assert/strict')

let definition
const calls = { openDocument: 0, purged: 0, dialogs: [] }
let loggedIn = false
let owner = ''

global.wx = {
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getStorageInfoSync: () => ({ keys: [] }),
  showToast: () => {},
  openDocument: () => { calls.openDocument += 1 },
}
global.Page = value => { definition = value }

function freshPreviewFiles() {
  const target = require.resolve('../utils/preview-temp-files')
  delete require.cache[target]
  require.cache[target] = {
    id: target,
    filename: target,
    loaded: true,
    exports: {
      purgeAll: async () => { calls.purged += 1 },
      removeByTaskId: async () => {},
      findByCacheKey: () => '',
      register: () => {},
      forget: () => {},
      touch: () => {},
    },
  }
}

function freshPage(nextLoggedIn, nextOwner) {
  loggedIn = nextLoggedIn
  owner = nextOwner
  freshPreviewFiles()
  const authTarget = require.resolve('../utils/auth')
  delete require.cache[authTarget]
  require.cache[authTarget] = {
    id: authTarget,
    filename: authTarget,
    loaded: true,
    exports: { isLoggedIn: () => loggedIn },
  }
  const storageTarget = require.resolve('../utils/storage')
  delete require.cache[storageTarget]
  require.cache[storageTarget] = {
    id: storageTarget,
    filename: storageTarget,
    loaded: true,
    exports: { ownerFingerprint: () => owner },
  }
  const pageTarget = require.resolve(
    '../subpackages/export/export-records/export-records'
  )
  delete require.cache[pageTarget]
  require(pageTarget)
  const page = {
    ...definition,
    data: {
      ...definition.data,
      list: [{ id: 1, file_format: 'pdf', status: 'completed' }],
      previewingTaskId: null,
    },
    _previewFileCache: new Map(),
    _previewDownloadPromises: new Map(),
    _pageDestroyed: false,
    _owner: nextLoggedIn ? nextOwner : '',
    _hasLoadedOnce: true,
    _loadPromise: Promise.resolve(),
    _loadPromiseReset: true,
    _suppressNextShowRefresh: true,
    _checkExportCapability: async () => false,
    _showDialog: async options => { calls.dialogs.push(options) },
    setData(patch) { Object.assign(this.data, patch) },
  }
  return page
}

async function run() {
  const anonymous = freshPage(false, '')
  anonymous._previewFileCache.set('1::0:', '/private/account-a.pdf')
  await anonymous.onPreview({ currentTarget: { dataset: { id: 1 } } })

  assert.equal(calls.openDocument, 0)
  assert.equal(calls.purged, 1)
  assert.equal(anonymous._previewFileCache.size, 0)
  assert.deepEqual(anonymous.data.list, [])
  assert.equal(anonymous.data.totalRecords, 0)
  assert.equal(calls.dialogs[0].title, '登录已过期')

  const authenticated = freshPage(true, 'account-a')
  authenticated._owner = 'account-a'
  let requestedTask = 0
  authenticated._getPreviewFile = async (task, previewOwner) => {
    requestedTask = task.id
    assert.equal(previewOwner, 'account-a')
    return '/private/current.pdf'
  }
  wx.openDocument = options => {
    calls.openDocument += 1
    options.success()
  }
  await authenticated.onPreview({ currentTarget: { dataset: { id: 1 } } })
  assert.equal(requestedTask, 1)
  assert.equal(calls.openDocument, 1)

  const switched = freshPage(true, 'account-a')
  switched._previewFileCache.set(
    'account-a:1:2026-11-19T00:00:00:0:',
    '/private/account-a.pdf'
  )
  owner = 'account-b'
  switched.onShow()
  assert.equal(calls.purged, 2)
  assert.equal(switched._previewFileCache.size, 0)
  assert.deepEqual(switched.data.list, [])
  assert.equal(switched._hasLoadedOnce, false)

  switched.data.list = [{ id: 1, file_format: 'pdf', status: 'completed' }]
  switched._owner = 'account-a'
  await switched.onPreview({ currentTarget: { dataset: { id: 1 } } })
  assert.equal(calls.openDocument, 1)
  assert.equal(calls.purged, 3)
  assert.equal(calls.dialogs.at(-1).title, '登录已过期')

  const registryTarget = require.resolve('../utils/preview-temp-files')
  delete require.cache[registryTarget]
  const records = new Map()
  wx.getStorageSync = key => records.has(key) ? records.get(key) : ''
  wx.setStorageSync = (key, value) => records.set(key, value)
  const registry = require('../utils/preview-temp-files')
  registry.register('/private/account-a.pdf', {
    owner: 'account-a',
    taskId: 1,
    cacheKey: 'account-a:1:',
  })
  assert.equal(registry.findByCacheKey('account-a:1:', 'account-a'), '/private/account-a.pdf')
  assert.equal(registry.findByCacheKey('account-a:1:', 'account-b'), '')
  assert.equal(registry.findByCacheKey('account-a:1:', ''), '')

  console.log('Export preview auth boundary regression passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})

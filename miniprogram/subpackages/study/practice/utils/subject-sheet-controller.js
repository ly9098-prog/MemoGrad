const { buildSubjectSheetView, buildSubjectSheetPage, findSubjectPath, subjectSheetGridRows } = require('./subject-sheet-view')
const SUBJECT_DOUBLE_TAP_INTERVAL = 320

function createSubjectSheetController(options) {
  return {
    open: () => open(options),
    hide: (afterClose, completed) => hide(options, afterClose, completed),
    handleOptionTap: (subjectId, source) => handleOptionTap(options, subjectId, source),
    change: event => change(options, event),
    browse: subjectId => browse(options, subjectId),
    chooseCard: subjectId => chooseCard(options, subjectId),
    stage: subjectId => stage(options, subjectId),
    confirm: () => confirm(options),
  }
}

function open(options) {
  const timer = options.getCloseTimer()
  if (timer) options.clearTimeout(timer)
  options.setCloseTimer(null)
  const view = options.getSubjectTree
    ? buildSubjectSheetView(options.getSubjectTree(), options.getSelectedSubjectId()) : {}
  options.setData({ ...view, subjectSheetVisible: true, subjectSheetClosing: false })
}

function currentPage(options) {
  if (!options.isVisible() || options.isClosing()) return null
  return (options.getSheetPages() || [])[options.getCurrentIndex()] || null
}

function change(options, event) {
  if (!currentPage(options)) return
  const detail = event && event.detail || {}
  const index = detail.current
  // Programmatic current updates emit change too. Only acknowledge touch, once.
  if (detail.source !== 'touch' || !Number.isInteger(index) || index === options.getCurrentIndex() ||
      index < 0 || index >= options.getSheetPages().length) return
  options.setData({ subjectSheetCurrent: index, subjectSheetDraft: null })
}

function browse(options, subjectId) {
  const page = currentPage(options)
  if (!page) return
  const root = options.getSubjectTree().find(node => node.subject_id === page.root_id)
  if (!root) return
  const path = findSubjectPath([root], subjectId)
  if (!path.length) return
  const pages = options.getSheetPages().slice()
  pages[options.getCurrentIndex()] = buildSubjectSheetPage(root, subjectId)
  options.setData({ subjectSheetPages: pages, subjectSheetGridRows: subjectSheetGridRows(options.getSubjectTree()) })
}

function chooseCard(options, subjectId) {
  const page = currentPage(options)
  const card = page && page.options.find(item => item.subject_id === Number(subjectId))
  if (!card) return
  if (card.has_children) browse(options, card.subject_id)
  else stage(options, card.subject_id)
}

function stage(options, subjectId) {
  const page = currentPage(options)
  if (!page || (page.node_id !== Number(subjectId) &&
      !page.options.some(item => item.subject_id === Number(subjectId) && !item.has_children))) return
  const path = findSubjectPath(options.getSubjectTree(), subjectId)
  const node = path[path.length - 1]
  if (!node || path[0].subject_id !== page.root_id) return
  options.setData({ subjectSheetDraft: {
    subject_id: node.subject_id,
    display_name: (node.children || []).length ? `${node.display_name}（全部）` : node.display_name,
  } })
}

function confirm(options) {
  if (!currentPage(options)) return
  const draft = options.getDraft()
  const path = draft && findSubjectPath(options.getSubjectTree(), draft.subject_id)
  if (!path || !path.length) return
  const node = path[path.length - 1]
  options.selectSubject(node.subject_id, draft.display_name, path[0].subject_id, (node.children || []).length > 0)
  hide(options)
}

function hide(options, afterClose, completed = false) {
  if (!options.isVisible()) {
    if (typeof afterClose === 'function') afterClose()
    return
  }
  if (completed) {
    const timer = options.getCloseTimer()
    if (timer) options.clearTimeout(timer)
    options.setCloseTimer(null)
    if (!options.isPageAlive()) return
    options.setData({ subjectSheetVisible: false, subjectSheetClosing: false }, () => {
      if (typeof afterClose === 'function') afterClose()
    })
    return
  }
  if (options.isClosing()) return
  const timer = options.getCloseTimer()
  if (timer) options.clearTimeout(timer)
  options.setData({ subjectSheetClosing: true }, () => {
    options.setCloseTimer(options.setTimeout(() => {
      options.setCloseTimer(null)
      if (!options.isPageAlive()) return
      options.setData(
        { subjectSheetVisible: false, subjectSheetClosing: false },
        () => {
          if (typeof afterClose === 'function') afterClose()
        },
      )
    }, 520))
  })
}

function handleOptionTap(options, subjectId, source) {
  const id = Number(subjectId)
  if (!id || !options.isVisible() || options.isClosing()) return
  const now = options.now()
  const key = `${source || 'subject'}:${id}`
  const lastTap = options.getLastTap()
  const isDoubleTap = Boolean(
    lastTap &&
    lastTap.key === key &&
    now - lastTap.time <= SUBJECT_DOUBLE_TAP_INTERVAL,
  )
  options.setLastTap(isDoubleTap ? null : { key, time: now })
  if (isDoubleTap) options.closeSheet()
}

module.exports = {
  createSubjectSheetController,
  SUBJECT_DOUBLE_TAP_INTERVAL,
}

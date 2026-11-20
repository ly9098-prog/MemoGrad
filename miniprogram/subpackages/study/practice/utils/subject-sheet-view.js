const { subjectIconMeta } = require('./subject-tree')

function findSubjectPath(subjectTree, subjectId) {
  for (const node of subjectTree || []) {
    if (node.is_active === false) continue
    if (Number(node.subject_id) === Number(subjectId)) return [node]
    const path = findSubjectPath(node.children, subjectId)
    if (path.length) return [node].concat(path)
  }
  return []
}

function preferredSubjectRoot(subjectTree) {
  return (subjectTree || []).find(node => String(node.subject_code || '').toLowerCase() === 'exam408') ||
    (subjectTree || [])[0]
}

function subjectSheetOption(node, root) {
  const icon = subjectIconMeta(node.display_name, node.subject_code)
  return {
    subject_id: Number(node.subject_id),
    display_name: node.display_name,
    has_children: (node.children || []).length > 0,
    icon_src: icon.src || root.icon_src || '',
    icon_mark: icon.mark,
  }
}

function buildSubjectSheetPage(root, subjectId) {
  const path = findSubjectPath([root], subjectId)
  const node = path[path.length - 1] || root
  const is408 = String(root.subject_code || '').toLowerCase() === 'exam408'
  const options = (node.children || []).filter(child => child.is_active !== false)
    .map(child => subjectSheetOption(child, root))
  return {
    root_id: root.subject_id,
    root_name: is408 && !/408/.test(root.display_name) ? `408 ${root.display_name}` : root.display_name,
    node_id: node.subject_id,
    node_name: node.display_name,
    is_root: node === root,
    back_id: path.length > 1 ? path[path.length - 2].subject_id : null,
    has_children: (node.children || []).length > 0,
    icon_src: root.icon_src,
    icon_mark: root.icon_mark,
    options,
    grid_rows: Math.min(2, Math.ceil(options.length / 2)),
  }
}

function subjectSheetGridRows(subjectTree) {
  let rows = 0
  const visit = node => {
    if (!node || node.is_active === false) return
    const children = (node.children || []).filter(child => child.is_active !== false)
    rows = Math.max(rows, Math.min(2, Math.ceil(children.length / 2)))
    children.forEach(visit)
  }
  const roots = subjectTree || []
  roots.forEach(visit)
  return rows
}

function buildSubjectSheetView(subjectTree, selectedSubjectId) {
  const path = findSubjectPath(subjectTree, selectedSubjectId)
  const selected = path[path.length - 1]
  const root = path[0] || preferredSubjectRoot(subjectTree)
  const pages = (subjectTree || []).map(item => {
    const current = item === root && selected
      ? ((selected.children || []).length ? selected : path[path.length - 2])
      : item
    return buildSubjectSheetPage(item, current ? current.subject_id : item.subject_id)
  })
  return {
    subjectSheetPages: pages,
    subjectSheetCurrent: Math.max(0, pages.findIndex(page => root && page.root_id === root.subject_id)),
    subjectSheetGridRows: subjectSheetGridRows(subjectTree),
    subjectSheetDraft: selected ? {
      subject_id: selected.subject_id,
      display_name: (selected.children || []).length ? `${selected.display_name}（全部）` : selected.display_name,
    } : null,
  }
}

module.exports = {
  findSubjectPath,
  preferredSubjectRoot,
  buildSubjectSheetPage,
  subjectSheetGridRows,
  buildSubjectSheetView,
}

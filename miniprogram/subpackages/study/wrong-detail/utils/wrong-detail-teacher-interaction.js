function toggleTeacherActions(page) {
if (page.data.teacherLoadingAction) return
page.setData({ teacherActionsExpanded: !page.data.teacherActionsExpanded })
}

function _teacherCacheKeyForWrong(wq, diagnosis, action) {
const item = wq || {}
const d = diagnosis || {}
return [
Number(item.id || 0),
Number(item.question_id || item.questionId || 0),
Number(d.question_version_id || d.questionVersionId || item.question_version_id || item.questionVersionId || 0),
Number(d.id || 0),
String(action || ''),
String(item.wrong_answer || ''),
].join('|')
}

function close408TeacherSheet(page) {
page.setData({ teacherSheetVisible: false })
}

module.exports = { toggleTeacherActions, _teacherCacheKeyForWrong, close408TeacherSheet }

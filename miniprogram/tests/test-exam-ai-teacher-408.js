const assert = require('node:assert/strict')
const { test: nodeTest } = require('node:test')
const path = require('node:path')

const teacher = require(process.env.STUDY_RESULT_BASELINE
  ? path.join(process.env.STUDY_RESULT_BASELINE, 'ai-teacher-408.js')
  : '../subpackages/study/utils/ai-teacher-408')
const test = (name, ...args) => nodeTest(`study: ${name}`, ...args)

test('teacher retains exports and the complete empty result shape and text', () => {
  assert.deepEqual(Object.keys(teacher), [
    'ACTIONS', 'PRIMARY_ACTIONS', 'MORE_ACTIONS', 'ACTION_BY_KEY',
    'normalizeResult', 'errorMessage',
  ])
  assert.deepEqual(teacher.normalizeResult({}), {
    action: '', actionLabel: 'AI 老师', title: 'AI 老师', summary: '', sections: [],
    knowledgePoints: [], practiceQuestion: null, nextAction: null, fromFallback: false,
    personalization: {}, promptVersion: '',
  })
  assert.equal(teacher.ACTIONS.length, 7)
  assert.deepEqual(teacher.PRIMARY_ACTIONS.map(item => item.action), [
    'explain_options', 'core_concept', 'explain_correct', 'connect_knowledge',
  ])
})

test('input decoding rejects primitives and accepts fenced JSON and historical wrappers', () => {
  for (const value of [null, undefined, false, 1, [], '', 'invalid', '[]', 'null']) {
    assert.equal(teacher.normalizeResult(value), null)
  }
  assert.equal(teacher.normalizeResult('```json\n{"action":"core_concept"}\n```').action, 'core_concept')
  assert.equal(teacher.normalizeResult('prefix {"title":" hi "} suffix').title, 'hi')
  assert.equal(teacher.normalizeResult({ result: { data: { title: 'inner' } } }).title, 'inner')
  assert.equal(teacher.normalizeResult({ data: { title: 'inner' }, action: 'outer' }).action, 'outer')
  assert.equal(teacher.normalizeResult({ data: { title: 'inner' }, sections: [] }).title, 'AI 老师')
  assert.notEqual(teacher.normalizeResult({ result: [] }), null)
})

test('summary groups and section traversal preserve aliases, order, deduplication and keys', () => {
  const result = teacher.normalizeResult({
    summary: { analysis: ' explain ', diagnosis: ' why ', suggestion: [' next '] },
    sections: [
      { heading: ' extra ', points: [' a ', 'b'] },
      { heading: 'extra', points: ['a', 'b'] },
    ],
  })
  assert.equal(result.summary, 'why')
  assert.deepEqual(result.sections, [
    { key: '0-错因诊断', heading: '错因诊断', points: ['why'] },
    { key: '1-复练建议', heading: '复练建议', points: ['next'] },
    { key: '2-题目解析', heading: '题目解析', points: ['explain'] },
    { key: '3-extra', heading: 'extra', points: ['a', 'b'] },
  ])
  const aliases = teacher.normalizeResult({ summary: { mistake_diagnosis: 0, diagnosis: 'later' } })
  assert.equal(aliases.summary, '0')
  assert.equal(teacher.normalizeResult({ summary: '{}' }).summary, '')
})

test('knowledge point projection preserves indexes while lesson paragraphs remain complete', () => {
  const items = [null, ...Array.from({ length: 10 }, (_, index) => ({
    name: ` name${index} `, relation: index, mastery_hint: 0, masteryHint: 'fallback',
  }))]
  const result = teacher.normalizeResult({ knowledge_points: items })
  assert.equal(result.knowledgePoints.length, 8)
  assert.deepEqual(result.knowledgePoints[0], {
    key: '1-name0', name: 'name0', relation: '0', masteryHint: 'fallback',
  })
  const sections = Array.from({ length: 10 }, (_, i) => ({ heading: `h${i}`, points: [1, 2, 3, 4, 5, 6] }))
  const limited = teacher.normalizeResult({ sections }).sections
  assert.equal(limited.length, 10)
  assert.deepEqual(limited[0].points, ['1', '2', '3', '4', '5', '6'])
  assert.equal(limited[9].heading, 'h9', 'the concluding section must not disappear')
})

test('practice projection preserves option enumeration, falsy values and alias precedence', () => {
  const result = teacher.normalizeResult({
    practice_question: {
      stem: ' stem ', options: { b: ' B ', 2: 0, 1: false, a: null, c: ' ' },
      answer: false, analysis: 0, difficulty_delta: 0, difficultyDelta: 2,
    },
    practiceQuestion: { stem: 'ignored' },
  }).practiceQuestion
  assert.deepEqual(result, {
    stem: 'stem', options: [
      { key: '1', text: 'false' }, { key: '2', text: '0' }, { key: 'b', text: 'B' },
    ],
    answer: 'false', analysis: '0', difficultyDelta: 0,
  })
  assert.equal(teacher.normalizeResult({ practice_question: 'truthy', practiceQuestion: {} }).practiceQuestion, null)
  assert.deepEqual(teacher.normalizeResult({ practiceQuestion: [] }).practiceQuestion.options, [])
  for (const [raw, expected] of [['-2', -2], ['bad', 0], [Infinity, Infinity], [false, 0]]) {
    assert.equal(teacher.normalizeResult({ practiceQuestion: { difficultyDelta: raw } })
      .practiceQuestion.difficultyDelta, expected)
  }
})

test('practice option getters keep repeated reads and precede field coercion and action lookup', () => {
  const events = []
  let reads = 0
  const practice = {
    get options() {
      reads += 1
      events.push(`options${reads}`)
      return reads < 4 ? { b: 'unused', a: 'unused' } : { b: ' B1 ', a: ' A2 ' }
    },
    get stem() { events.push('stem'); return 's' },
    get answer() { events.push('answer'); return 'a' },
    get analysis() { events.push('analysis'); return 'p' },
    get difficulty_delta() { events.push('difficulty'); return 1 },
  }
  const source = {
    sections: [{ heading: '考点', points: ['判断依据。'] }],
    get knowledge_points() { events.push('knowledge'); return [] },
    get practice_question() { events.push('practice'); return practice },
    get practiceQuestion() { throw new Error('unexpected alias read') },
    get action() { events.push('action'); return 'core_concept' },
  }
  assert.deepEqual(teacher.normalizeResult(source).practiceQuestion.options,
    [{ key: 'b', text: 'B1' }, { key: 'a', text: 'A2' }])
  assert.deepEqual(events, [
    'knowledge', 'knowledge', 'practice', 'options1', 'options2', 'options3',
    'options4', 'options5', 'stem', 'answer', 'analysis', 'difficulty', 'action',
  ])
})

test('practice coercion and getter failures propagate unchanged before action lookup', () => {
  const failure = new Error('practice failure')
  for (const practice of [
    { get options() { throw failure } },
    { stem: { toString() { throw failure } } },
    { difficulty_delta: { valueOf() { throw failure } } },
  ]) {
    const source = {
      practice_question: practice,
      get action() { throw new Error('action read too early') },
    }
    assert.throws(() => teacher.normalizeResult(source), error => error === failure)
  }
})

test('result aliases retain truthiness, nullish precedence and referenced objects', () => {
  const next = [], personalization = []
  const result = teacher.normalizeResult({
    action: 'core_concept', action_label: 0, actionLabel: ' custom ',
    sections: [{ heading: '考点', points: ['判断依据。'] }],
    next_action: next, nextAction: { ignored: true }, personalization,
    from_fallback: false, fromFallback: true, prompt_version: 0, promptVersion: ' v2 ',
  })
  assert.equal(result.actionLabel, 'custom')
  assert.equal(result.title, '这道题真正考什么')
  assert.equal(result.nextAction, next)
  assert.equal(result.personalization, personalization)
  assert.equal(result.fromFallback, false)
  assert.equal(result.promptVersion, 'v2')
})

test('action metadata mutation is observed while replacing its exported object stays local', t => {
  const metadata = teacher.ACTION_BY_KEY, oldLabel = metadata.core_concept.label
  t.after(() => { teacher.ACTION_BY_KEY = metadata; metadata.core_concept.label = oldLabel })
  metadata.core_concept.label = 'patched label'
  const lesson = { action: 'core_concept', sections: [{ heading: '考点', points: ['判断依据。'] }] }
  assert.equal(teacher.normalizeResult(lesson).title, 'patched label')
  teacher.ACTION_BY_KEY = {}
  assert.equal(teacher.normalizeResult(lesson).title, 'patched label')
})

test('error text keeps exam guard and unavailable messages', () => {
  const failure = new Error('network')
  const api = {
    getErrorMessage(error) { assert.equal(this, api); assert.equal(error, failure); return 'exam_in_progress_ai_blocked' },
  }
  assert.equal(teacher.errorMessage(failure, api), '考试进行中不开放答案型 AI 讲解，请交卷后再使用。')
  assert.equal(teacher.errorMessage(null), 'AI 老师暂不可用，请稍后重试')
  assert.equal(teacher.submitFeedback, undefined)
})

test('legacy option fallback never appears as a completed per-option lesson', () => {
  const result = teacher.normalizeResult({
    action: 'explain_options', from_fallback: true, prompt_version: '408-teacher-v3',
    title: '逐项讲解 A/B/C/D', summary: '本题属于“总线与 I/O”的典型辨析。',
    sections: [{ heading: '通用提示', points: ['注意边界条件。'] }],
  })
  assert.equal(result.title, '这次讲解未完成')
  assert.match(result.summary, /未生成 AI 讲解/)
  assert.doesNotMatch(result.summary, /典型辨析/)
  assert.deepEqual(result.sections, [])
  assert.equal(teacher.normalizeResult({
    action: 'explain_options', from_fallback: true,
    summary: '今日额度已用尽。本次未生成逐项讲解。',
  }).summary, 'AI 调用额度不足，可先查看题库解析。')
})

test('all teacher fallbacks discard legacy copied analysis and generated fields', () => {
  for (const { action } of teacher.ACTIONS) {
    const result = teacher.normalizeResult({
      action, from_fallback: true,
      summary: '生产者与消费者是经典同步问题。',
      sections: [{ heading: '旧内容', points: ['原题解析'] }],
      knowledge_points: [{ name: '原题知识点' }],
      practice_question: { stem: '旧题' },
      next_action: { type: 'practice', params: { id: 1 } },
    })
    assert.match(result.summary, /未生成/)
    assert.doesNotMatch(result.summary, /经典同步问题/)
    assert.deepEqual(result.sections, [])
    assert.deepEqual(result.knowledgePoints, [])
    assert.equal(result.practiceQuestion, null)
    assert.equal(result.nextAction, null)
  }
})

test('teacher fallback shows its cause once across legacy wrappers', () => {
  const summary = 'AI 返回格式异常。本次未生成 AI 讲解，请稍后重试。'
  for (const { action } of teacher.ACTIONS.filter(item => item.action !== 'explain_options')) {
    const result = teacher.normalizeResult({ result: {
      action, fromFallback: true, summary,
    } })
    assert.equal(result.summary, 'AI 返回格式异常。')
    assert.equal(result.fromFallback, true)
  }
  const success = teacher.normalizeResult({
    action: 'explain_correct', summary: '有效讲解',
    sections: [{ heading: '条件', points: ['根据题干条件可以判断正确项。'] }],
  })
  assert.equal(success.summary, '有效讲解')
  assert.equal(success.sections.length, 1)
})

test('machine failure reasons distinguish missing text from truncation, filtering and invalid format', () => {
  for (const [reason, message] of [
    ['missing_body', '未收到可展示的讲解正文'],
    ['output_truncated', '输出长度上限'],
    ['content_filtered', '安全策略过滤'],
    ['invalid_format', '格式无法解析'],
    ['invalid_options', '答案一致性校验'],
    ['invalid_question', '完整答案和解析'],
    ['budget_exhausted', '额度不足'],
    ['service_unavailable', '暂不可用'],
  ]) {
    const result = teacher.normalizeResult({ action: 'explain_correct', from_fallback: true,
      fallback_reason: reason, summary: '旧的统一错误提示。本次未生成 AI 讲解，请稍后重试。' })
    assert.ok(result.summary.includes(message), reason)
    assert.equal(result.fallbackReason, reason)
    assert.doesNotMatch(result.summary, /旧的统一错误提示|本次未生成 AI 讲解/)
    assert.deepEqual(result.sections, [])
  }
  const unknown = teacher.normalizeResult({ action: 'explain_correct', from_fallback: true,
    fallback_reason: 'new_server_reason', summary: '任意内部错误详情' })
  assert.doesNotMatch(unknown.summary, /任意内部错误详情/)
})

test('a long summary and a four-character opening fragment do not constitute a lesson', () => {
  for (const action of ['explain_correct', 'core_concept', 'high_frequency_traps', 'connect_knowledge']) {
    const result = teacher.normalizeResult({
      action, title: '完整推理链', summary: '本题适用奈奎斯特定理，代入题干条件后得到正确答案。'.repeat(5),
      sections: [{ heading: '第一步：确定适用公式——无噪声→奈奎斯特定理', points: ['题干明确'] }],
    })
    assert.equal(result.fromFallback, true, action)
    assert.match(result.summary, /未收到可展示的讲解正文/)
    assert.deepEqual(result.sections, [])
  }
})

test('concise formulas, a short complete explanation and multiple brief points remain valid', () => {
  for (const points of [['R=2Wlog₂V=48kb/s'], ['检错能力为最小距离减一。'],
    ['无噪声信道', 'R=2Wlog₂V'], ['栈是后进先出。'], ['O(n)'], ['t=2'], ['互斥', '同步'],
    ['题干明确无噪声'], ['必须满足全部条件'], ['n<=1'], ['n>=1'], ['n==1'], ['n!=1']]) {
    const result = teacher.normalizeResult({ action: 'explain_correct', sections: [{ heading: '依据', points }] })
    assert.equal(result.fromFallback, false)
    assert.deepEqual(result.sections[0].points, points)
  }
})

test('metadata inside a structured summary never substitutes for teaching points', () => {
  for (const summary of [{ title: '仅标题但并无独立教学正文', summary: '仅摘要也并无独立教学正文' },
    JSON.stringify({ title: '仅标题但并无独立教学正文', summary: '仅摘要也并无独立教学正文' })]) {
    const result = teacher.normalizeResult({ action: 'explain_correct', summary, sections: [] })
    assert.equal(result.fromFallback, true)
    assert.deepEqual(result.sections, [])
    const valid = teacher.normalizeResult({ action: 'explain_correct', summary,
      sections: [{ heading: '依据', points: ['栈是后进先出。'] }] })
    assert.equal(valid.fromFallback, false)
    assert.equal(valid.summary, '栈是后进先出。')
  }
  const legacy = teacher.normalizeResult({ action: 'explain_correct',
    summary: JSON.stringify({ analysis: '检错能力为最小距离减一。' }) })
  assert.equal(legacy.fromFallback, false, 'known historical teaching fields remain compatible')
})

test('a repeated opening or an unfinished short formula remains a fragment', () => {
  for (const points of [['题干明确', '题干明确'], ['t=']]) {
    const result = teacher.normalizeResult({ action: 'explain_correct', sections: [{ heading: '依据', points }] })
    assert.equal(result.fromFallback, true)
  }
})

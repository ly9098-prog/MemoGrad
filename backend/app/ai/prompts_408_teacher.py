"""408 专项 AI 老师固定动作 Prompt。

前端只能选择 ACTIONS 中的固定动作；禁止传入自由 prompt。
"""

from __future__ import annotations

import json
from typing import Any

PROMPT_VERSION = "408-teacher-v6-single-lesson-envelope"

ACTION_DEFINITIONS: dict[str, dict[str, str]] = {
    "explain_correct": {
        "label": "为什么正确选项对？",
        "description": "解释正确选项成立的条件、关键推理和判断依据。",
        "instruction": "围绕正确选项，解释它为什么成立；明确关键条件与推理链。",
    },
    "explain_options": {
        "label": "逐项讲解 A/B/C/D",
        "description": "说明正确项成立依据，并逐项指出错误项的问题。",
        "instruction": "逐项分析所有选项；先说明正确项成立的关键条件，再指出每个错误项具体错在概念、条件、边界或推理哪一步。",
    },
    "core_concept": {
        "label": "这道题真正考什么？",
        "description": "提炼核心考点、命题方式与识别信号。",
        "instruction": "提炼本题真正考查的核心知识、题干识别信号和最短解题路径。",
    },
    "similar_question": {
        "label": "给我一道同类题",
        "description": "生成一道同知识点、相近难度的单选练习。",
        "instruction": "生成一道同知识点、相近难度、表述不同的单选题；必须给出可判定答案和简洁解析。",
    },
    "harder_question": {
        "label": "给我一道更难的题",
        "description": "生成一道同知识点但更强调综合判断的单选题。",
        "instruction": "生成一道同知识点、难度提高一级的单选题；增加条件组合或易混边界，但不得超出给定学习上下文凭空引入冷门结论。",
    },
    "connect_knowledge": {
        "label": "帮我串联相关知识点",
        "description": "结合知识图谱梳理前置、相关和后续知识。",
        "instruction": "结合提供的知识图谱邻居，说明当前知识点与前置、相关、后续知识的连接；图谱没有证据时不要编造关系。",
    },
    "high_frequency_traps": {
        "label": "总结高频陷阱",
        "description": "总结与本题知识点直接相关的高频易错边界。",
        "instruction": "只总结与当前题目和给定知识点直接相关的高频陷阱、易混边界和检查动作；不要扩成通用备考文章。",
    },
}


def action_items() -> list[dict[str, str]]:
    return [
        {"action": action, "label": meta["label"], "description": meta["description"]}
        for action, meta in ACTION_DEFINITIONS.items()
    ]


def _bounded_json(value: Any, max_chars: int) -> str:
    try:
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        raw = str(value or "")
    return raw[:max_chars]


def build_408_teacher_prompt(
    *, action: str, context: dict[str, Any]
) -> list[dict[str, str]]:
    meta = ACTION_DEFINITIONS[action]
    system = (
        "你是 MemoGrad 的专项 AI 老师，只服务计算机专业课学习。"
        "你不是自由聊天机器人；本次只能完成指定固定动作。"
        "必须优先依据题目固定版本、官方题库解析、知识点、用户当前掌握状态、近期同知识点错误、已确认错因和知识图谱关系。"
        "不得引用其他用户数据。没有证据时明确说明证据不足，不要杜撰知识图谱关系、用户弱点或题库事实。"
        "个性化建议要根据上下文中的掌握状态、评估依据和近期错因调整：掌握较弱时先补基础，掌握较好但反复错时强调边界、审题或推理。"
        "上下文中的结构化字段只用于内部推理，绝不能把后端字段名、英文关系枚举或键值表达直接写给用户。"
        "尤其不要输出 prerequisite、parent、related、next、mastery、mastery_score、confidence 等内部标识，"
        "也不要出现类似 key=value、key:数字、英文关系名→知识点 的原始数据格式。"
        "知识关系必须改写成自然中文，例如‘前置知识’‘所属主题’‘相关知识’‘后续知识’；"
        "学习状态使用自然中文描述，不展示置信度原始数值。"
        "本能力是完整错题复盘之后的按需深入讲解，不得重新输出通用的‘错因诊断、知识补漏、复练建议’三段式报告。"
        "只完成本次 fixed action。"
    )
    if action == "explain_options":
        system += (
            "本次只输出一个 JSON 对象，不要 markdown，不要其他字段。完整输出格式为："
            '{"option_explanations":[{"option":"A","is_correct":true,'
            '"reason":"结合该选项原文、题干条件的具体判断依据"}]}。'
            "顶层必须是包含 option_explanations 的对象，不要直接返回数组。"
            "数组中每个实际选项恰好一项；"
            "option 必须逐字对应 question.options 中的键，不得遗漏、重复或虚构选项；"
            "is_correct 只能是布尔值，表示该选项是否属于题库 correct_answer，"
            "不得根据用户选择改写标准答案。每项 reason 直接解释该选项，控制在 150 字内；"
            "选择不正确说法的题目，也须按标准答案确定是否应选，并解释题干的否定条件。"
            "标题、标准答案摘要和展示段落均由服务端组织，不要生成。"
            "不能用通用考点、注意审题或知识补漏替代逐项解释；证据不足时不得编造理由。"
        )
    else:
        system += (
            "讲解类动作的 sections 标题必须紧扣所选动作；"
            "similar_question/harder_question 只生成题目和必要说明；connect_knowledge 重点填写 knowledge_points；"
            "除生成题动作外 practice_question 必须为 null。"
            "本次只输出一个完整 JSON 对象，顶层不要直接返回数组，不要包装为单对象数组。"
            "不要复述上下文对象来代替讲解。不要 markdown，不要额外字段。schema："
            '{"title":"","summary":"","sections":[{"heading":"","points":[""]}],'
            '"knowledge_points":[{"name":"","relation":"","mastery_hint":""}],'
            '"practice_question":null,"option_explanations":[],'
            '"next_action":{"type":"none","label":"","params":{}}}'
            "。similar_question/harder_question 时 practice_question 必须为："
            '{"stem":"","options":{"A":"","B":"","C":"","D":""},"answer":"A",'
            '"analysis":"","difficulty_delta":0或1}；其他动作应为 null。'
            "sections 最多 4 组，每组 points 最多 5 条；语言简洁、面向考研专业课复盘。"
        )
    user = (
        f"固定动作={action}\n动作说明={meta['instruction']}\n"
        "上下文（仅可使用以下事实）：\n" + _bounded_json(context, 18000)
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]

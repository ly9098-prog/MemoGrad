import { LegalPage } from "@/components/legal-page";

export default function AiDisclaimerPage() {
  return (
    <LegalPage
      title="AI 免责声明"
      intro="AI 与 OCR 用于辅助学习，不替代教材、课程、官方答案和个人判断。"
      updated="2026 年 11 月 20 日更新"
      sections={[
        {
          title: "解析结果性质",
          paragraphs: ["AI 解析结果仅供学习参考，不构成标准答案、唯一解法或考试承诺。"],
        },
        {
          title: "OCR 识别误差",
          paragraphs: ["OCR 可能对文字、公式、选项、表格和图片内容产生识别误差，导入内容需要经过审核与人工确认。"],
        },
        {
          title: "生成内容限制",
          paragraphs: ["AI 生成内容不保证完整、实时或适用于所有题型与考试场景，也可能出现事实错误或推理遗漏。"],
        },
        {
          title: "用户核验责任",
          paragraphs: ["用户应结合教材、课程、教师意见、官方答案和个人判断核对内容正确性，并对基于 AI 建议作出的学习决定负责。"],
        },
        {
          title: "数据处理提示",
          paragraphs: ["使用 AI 辅助功能时，仅提交完成该功能所必需的题目内容。请勿上传身份证件、联系方式、未公开试题或其他与服务无关的敏感信息。"],
        },
      ]}
    />
  );
}

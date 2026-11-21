import { LegalPage } from "@/components/legal-page";

const USER_AGREEMENT_VERSION =
  process.env.NEXT_PUBLIC_USER_AGREEMENT_VERSION || "2026-11-20";

export default function UserAgreementPage() {
  return (
    <LegalPage
      title="用户协议"
      intro="请在使用 MemoGrad 网页账号、题库浏览、账号中心与小程序学习服务前阅读以下说明。"
      version={USER_AGREEMENT_VERSION}
      updated="2026 年 11 月 20 日更新"
      sections={[
        {
          title: "服务内容",
          paragraphs: [
            "MemoGrad 提供学习、刷题、错题整理、复习安排与内容辅助服务。网页账号中心提供账号登录、身份关联、安全设置、已发布题库和知识关系浏览；小程序继续提供原生学习功能。",
          ],
        },
        {
          title: "使用规范",
          paragraphs: [
            "用户应遵守法律法规及平台规范，不得提交违法、侵权、恶意干扰服务或其他不当内容。",
          ],
        },
        {
          title: "账号与身份关联",
          bullets: [
            "MemoGrad 网页账号可使用密码、邮箱验证码或 GitHub 登录，并可在网页账号中心主动绑定已验证邮箱和 GitHub，关联到当前用户 ID 与学习记录。",
            "小程序仅提供微信一键登录，不提供邮箱或 GitHub 登录及身份管理入口。微信 Web 绑定方式待定，当前不开放。",
            "相同邮箱不会自动合并两个已有账号。身份已属于其他账号时，系统会拒绝绑定并提示使用原账号登录。",
            "用户应至少保留一种可用登录方式，并对本人账号的使用行为负责。",
            "Admin 账号与普通用户账号属于独立身份域，普通用户登录方式不能获得后台管理权限。",
          ],
        },
        {
          title: "内容审核与准确性",
          paragraphs: [
            "平台会对导入内容和学习内容进行必要的审核与处理，但不保证所有内容都完全准确。AI 与 OCR 结果仅作辅助，用户应结合教材、课程和官方资料自行核验。",
          ],
        },
        {
          title: "安全变更",
          paragraphs: [
            "换邮箱、解绑身份和影响小程序登录的操作可能需要重新验证。安全变更完成后，此前登录会话会失效，需要重新登录。全部身份失联时，应先通过相应身份服务商恢复，不提供绕过身份验证的自助找回。",
          ],
        },
        {
          title: "协议更新",
          paragraphs: [
            "协议发生重大变更时，平台会在登录或账号页面提示新版本。继续使用服务前，需要重新阅读并同意更新后的版本。",
          ],
        },
      ]}
    />
  );
}

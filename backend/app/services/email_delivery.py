import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from html import escape

from app.core.config import settings


class EmailDeliveryError(RuntimeError):
    pass


def _send_message(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(
            settings.SMTP_HOST,
            settings.SMTP_PORT,
            timeout=settings.SMTP_TIMEOUT_SEC,
            context=context,
        ) as client:
            if settings.SMTP_USERNAME:
                client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            client.send_message(message)
        return
    with smtplib.SMTP(
        settings.SMTP_HOST,
        settings.SMTP_PORT,
        timeout=settings.SMTP_TIMEOUT_SEC,
    ) as client:
        client.ehlo()
        if settings.SMTP_USE_STARTTLS:
            client.starttls(context=context)
            client.ehlo()
        if settings.SMTP_USERNAME:
            client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        client.send_message(message)


def _build_message(
    to_email: str, subject: str, text: str, html: str | None = None
) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL))
    message["To"] = to_email
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")
    return message


async def send_auth_email(
    *, to_email: str, subject: str, text: str, html: str | None = None
) -> None:
    if not settings.AUTH_EMAIL_ENABLED:
        raise EmailDeliveryError("邮件登录暂未启用")
    if not settings.SMTP_HOST or not settings.SMTP_FROM_EMAIL:
        raise EmailDeliveryError("邮件服务配置不完整")
    message = _build_message(to_email, subject, text, html)
    try:
        await asyncio.to_thread(_send_message, message)
    except (OSError, smtplib.SMTPException, TimeoutError) as exc:
        raise EmailDeliveryError("邮件发送失败，请稍后重试") from exc


def _render_otp_email(
    *,
    title: str,
    intro: str,
    code: str,
    expiry_minutes: int,
    badge: str,
) -> str:
    security_scope = "管理员账号安全通知" if badge == "ADMIN" else "学习账号安全通知"
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef4fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef4fa" style="background-color:#eef4fa;background-image:linear-gradient(180deg,#f8fcff 0%,#eef4fa 100%);padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="border:1px solid #dce9f3;border-radius:20px;background-color:#ffffff;box-shadow:0 22px 60px rgba(37,99,138,0.13);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border-radius:20px;background-color:#ffffff;background-image:linear-gradient(150deg,#ffffff 0%,#fbfdff 55%,#f2f9fe 100%);">
<tr><td style="padding:26px 32px 0;">
<p style="margin:0;font-size:17px;font-weight:600;letter-spacing:-0.2px;color:#152b3b;">MemoGrad<span style="margin-left:10px;padding:4px 8px;border:1px solid #d6e8f3;border-radius:999px;background-color:#f2f9fe;font-size:9px;font-weight:500;letter-spacing:1.6px;color:#25638a;">{badge}</span></p>
</td></tr>
<tr><td style="padding:26px 32px 0;">
<p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#25638a;">{title}</p>
<h1 style="margin:9px 0 0;font-size:25px;line-height:1.4;font-weight:600;letter-spacing:-0.4px;color:#152b3b;">你的验证码</h1>
<p style="margin:10px 0 0;font-size:13px;line-height:22px;color:#52697a;">{intro}</p>
</td></tr>
<tr><td style="padding:22px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4faff" style="border:1px solid #d8eaf5;border-radius:14px;background-color:#f4faff;background-image:linear-gradient(160deg,#f8fcff 0%,#eff8fe 100%);">
<tr><td align="center" style="padding:20px 12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:9px;color:#152b3b;">{escape(code)}</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 32px 0;">
<p style="margin:0;font-size:12px;line-height:20px;color:#52697a;">验证码 <strong style="color:#24735b;font-weight:600;">{expiry_minutes} 分钟内有效</strong>，请勿转发给他人。</p>
</td></tr>
<tr><td style="padding:22px 32px 26px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #e6eff6;padding-top:16px;">
<p style="margin:0;font-size:11px;line-height:18px;color:#7c93a3;">如果不是你本人操作，请忽略本邮件，你的账号不会发生变更。<br>此邮件由系统自动发送，请勿直接回复。</p>
</td></tr></table>
</td></tr>
</table>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:10px;line-height:16px;color:#94a9b8;text-align:center;">MemoGrad · {security_scope}</p>
</td></tr>
</table>
</body>
</html>"""


def build_otp_email(domain: str, purpose: str, code: str) -> tuple[str, str, str]:
    labels = {
        "login": "登录验证码",
        "register": "注册验证码",
        "bind": "绑定邮箱验证码",
        "step_up": "安全验证验证码",
        "activate": "邮箱验证码",
        "recover": "密码恢复验证码",
    }
    intros = {
        "login": "请在登录页面输入以下验证码，完成身份验证。",
        "register": "请在注册页面输入以下验证码，完成邮箱验证。",
        "bind": "请在账号设置中输入以下验证码，完成邮箱绑定。",
        "step_up": "请在安全验证窗口输入以下验证码，继续当前操作。",
        "activate": "请在管理端输入以下验证码，激活管理员邮箱。",
        "recover": "请在密码恢复页面输入以下验证码。",
    }
    is_admin = domain == "admin"
    title = labels.get(purpose, "安全验证码")
    prefix = "MemoGrad 管理员" if is_admin else "MemoGrad"
    subject = f"【{prefix}】{title}"
    expiry_minutes = max(1, settings.OTP_EXPIRE_SEC // 60)
    text = (
        f"你的验证码是：{code}\n\n"
        f"验证码 {expiry_minutes} 分钟内有效，请勿转发给他人。"
        "若不是你本人操作，请忽略本邮件。\n"
    )
    html = _render_otp_email(
        title=title,
        intro=intros.get(purpose, "请在页面中输入以下验证码，完成身份验证。"),
        code=code,
        expiry_minutes=expiry_minutes,
        badge="ADMIN" if is_admin else "LEARN",
    )
    return subject, text, html

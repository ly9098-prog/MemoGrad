import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

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


def _build_message(to_email: str, subject: str, text: str) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL))
    message["To"] = to_email
    message.set_content(text)
    return message


async def send_auth_email(*, to_email: str, subject: str, text: str) -> None:
    if not settings.AUTH_EMAIL_ENABLED:
        raise EmailDeliveryError("邮件登录暂未启用")
    if not settings.SMTP_HOST or not settings.SMTP_FROM_EMAIL:
        raise EmailDeliveryError("邮件服务配置不完整")
    message = _build_message(to_email, subject, text)
    try:
        await asyncio.to_thread(_send_message, message)
    except (OSError, smtplib.SMTPException, TimeoutError) as exc:
        raise EmailDeliveryError("邮件发送失败，请稍后重试") from exc


def build_otp_email(domain: str, purpose: str, code: str) -> tuple[str, str]:
    labels = {
        "login": "登录验证码",
        "register": "注册验证码",
        "bind": "绑定邮箱验证码",
        "step_up": "安全验证验证码",
        "activate": "管理员邮箱验证码",
        "recover": "管理员密码恢复验证码",
    }
    domain_label = "管理员" if domain == "admin" else "MemoGrad"
    subject = f"{domain_label}{labels.get(purpose, '安全验证码')}"
    text = (
        f"你的验证码是：{code}\n\n"
        f"验证码 5 分钟内有效，请勿转发给他人。若不是你本人操作，请忽略本邮件。\n"
    )
    return subject, text

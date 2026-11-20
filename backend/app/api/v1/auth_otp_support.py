from fastapi import HTTPException, Request

from app.services import email_otp_service, slider_captcha_service


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _raise_otp(exc: email_otp_service.OtpError) -> None:
    if isinstance(exc, email_otp_service.OtpRateLimitError):
        raise HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, email_otp_service.OtpUnavailableError):
        raise HTTPException(status_code=503, detail=str(exc))
    raise HTTPException(status_code=400, detail=str(exc))


def _raise_slider_captcha(exc: slider_captcha_service.SliderCaptchaError) -> None:
    if isinstance(exc, slider_captcha_service.SliderCaptchaRateLimitError):
        raise HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, slider_captcha_service.SliderCaptchaUnavailableError):
        raise HTTPException(status_code=503, detail=str(exc))
    raise HTTPException(status_code=400, detail=str(exc))

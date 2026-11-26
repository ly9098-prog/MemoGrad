from pydantic import Field

from app.schemas.base import BaseModel


class SliderCaptchaStartRequest(BaseModel):
    purpose: str = Field(min_length=4, max_length=16, pattern=r"^[a-z]+$")
    email: str = Field(min_length=3, max_length=254)


class SliderCaptchaStartResponse(BaseModel):
    captcha_id: str
    image: str
    thumb: str
    width: int
    height: int
    thumb_width: int
    thumb_height: int
    thumb_x: int
    thumb_y: int
    expires_in: int


class SliderTrajectoryPoint(BaseModel):
    x: int = Field(ge=0, le=1000)
    y: int = Field(ge=-200, le=1000)
    t: int = Field(ge=0, le=120000)


class SliderCaptchaVerifyRequest(BaseModel):
    captcha_id: str = Field(min_length=32, max_length=64)
    x: int = Field(ge=0, le=1000)
    y: int = Field(ge=-200, le=1000)
    trajectory: list[SliderTrajectoryPoint] = Field(min_length=2, max_length=64)


class SliderCaptchaVerifyResponse(BaseModel):
    ticket: str
    expires_in: int

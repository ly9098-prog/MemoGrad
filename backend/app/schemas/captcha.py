from pydantic import Field

from app.schemas.base import BaseModel


class SliderCaptchaStartResponse(BaseModel):
    captcha_id: str
    background_image: str
    puzzle_image: str
    width: int
    height: int
    piece_size: int
    piece_y: int
    expires_in: int


class SliderTrajectoryPoint(BaseModel):
    x: int = Field(ge=0, le=1000)
    y: int = Field(ge=-200, le=1000)
    t: int = Field(ge=0, le=120000)


class SliderCaptchaVerifyRequest(BaseModel):
    captcha_id: str = Field(min_length=32, max_length=64)
    offset: int = Field(ge=0, le=1000)
    trajectory: list[SliderTrajectoryPoint] = Field(min_length=2, max_length=64)


class SliderCaptchaVerifyResponse(BaseModel):
    ticket: str
    expires_in: int

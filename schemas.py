from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1500)


class ChatRequest(BaseModel):
    message: str = Field(max_length=500)
    history: list[Turn] = Field(default_factory=list, max_length=12)

    @field_validator("message")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        return v


class Source(BaseModel):
    n: int
    id: str
    title: str
    section: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    handoff: bool
    grounded: bool
    intent: str

"""Shared contract primitives."""

from enum import StrEnum

from pydantic import BaseModel, Field


class Source(StrEnum):
    AI = "ai"
    TEMPLATE = "template"


class TextPayload(BaseModel):
    text: str = Field(min_length=1)
    source: Source

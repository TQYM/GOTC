"""SSE 事件 data 形状（02 §3.8），人设与触发规则见 04。"""

from enum import StrEnum

from pydantic import BaseModel, Field

from app.contracts.metrics import Metrics, Phase


class NewsSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ALERT = "alert"


class NewsEvent(BaseModel):
    headline: str = Field(max_length=20)
    body: str = Field(max_length=80)
    severity: NewsSeverity
    at_year: int = Field(ge=1)


class CitizenSentiment(StrEnum):
    ANGRY = "angry"
    HAPPY = "happy"
    NEUTRAL = "neutral"


class CitizenTopic(StrEnum):
    COMMUTE = "commute"
    EDU = "edu"
    MED = "med"
    GREEN = "green"
    PRICE = "price"
    POLLUTION = "pollution"


class CitizenEvent(BaseModel):
    persona: str
    text: str = Field(max_length=60)
    sentiment: CitizenSentiment
    topic: CitizenTopic


class TheoryRef(StrEnum):
    TOD = "tod"
    LIFE_CIRCLE_15 = "life_circle_15"
    JOBS_HOUSING_BALANCE = "jobs_housing_balance"
    GREEN_NETWORK = "green_network"
    ROAD_HIERARCHY = "road_hierarchy"


class MentorSeverity(StrEnum):
    SUGGESTION = "suggestion"
    WARNING = "warning"


class MentorEvent(BaseModel):
    comment: str = Field(max_length=120)
    theory_refs: list[TheoryRef]
    severity: MentorSeverity


class PhaseChangeEvent(BaseModel):
    phase: Phase
    time_left_sec: int = Field(ge=0)


class ProjectionStep(BaseModel):
    year: int = Field(ge=1)
    metrics: Metrics


class ReportReadyEvent(BaseModel):
    report_text: str
    city_name: str


class SseErrorEvent(BaseModel):
    code: str
    message: str

"""SSE 事件 data 形状（02 §3.8），人设与触发规则见 04。"""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.contracts.common import Source
from app.contracts.metrics import Metrics, Phase


class NewsSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ALERT = "alert"


class NewsEvent(BaseModel):
    headline: str = Field(max_length=20)
    body: str = Field(max_length=80)
    severity: NewsSeverity
    at_year: int = Field(ge=0)
    source: Source


class CitizenSentiment(StrEnum):
    ANGRY = "angry"
    HAPPY = "happy"
    NEUTRAL = "neutral"


class CitizenPersona(StrEnum):
    PROGRAMMER_LI = "程序员小李"
    MOTHER_WANG = "带娃妈妈王姐"
    SHOPKEEPER_ZHOU = "个体户老周"
    RETIRED_TEACHER_CHEN = "退休教师陈伯"
    TENANT_ZI = "外地租客阿紫"


class CitizenTopic(StrEnum):
    COMMUTE = "commute"
    EDU = "edu"
    MED = "med"
    GREEN = "green"
    PRICE = "price"
    POLLUTION = "pollution"


class CitizenEvent(BaseModel):
    persona: CitizenPersona
    text: str = Field(max_length=60)
    sentiment: CitizenSentiment
    topic: CitizenTopic
    source: Source


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
    top_issues: list[str] = Field(default_factory=list, max_length=3)
    source: Source


class PhaseChangeEvent(BaseModel):
    phase: Phase
    time_left_sec: int = Field(ge=0)


class ProjectionStep(BaseModel):
    year: int = Field(ge=1)
    metrics: Metrics
    events: list[str] = Field(default_factory=list)
    source: Source = Source.TEMPLATE


class ReportReadyEvent(BaseModel):
    report: "Report"
    city_name: str
    source: Source


class SseErrorEvent(BaseModel):
    code: str
    message: str


class ReportDimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    population: str
    balance: str
    green: str
    traffic: str
    happiness: str


class Report(BaseModel):
    overview: str
    dimensions: ReportDimensions
    ending_story: str
    source: Source

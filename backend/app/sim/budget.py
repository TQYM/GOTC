"""市政预算（对齐 C:S `EconomyManager` 的核心结构）。

C:S 的做法：
- 一天 = 256 帧 = 16 个 16 帧的日分段；账本 `m_income[]/m_expenses[]` 各 182 类 × 17 槽
  （16 段 + 1 个当日累计），每 256 帧把 16 段汇总进第 17 槽并清零。
- 税率是四维查表（service × subservice × level），区政策再叠加固定 ±2 个百分点。
- 贷款按「剩余期数」摊销，不是简单利息。
- 暂停（subStep=0）与预热（subStep=1000）都跳过经济。

CITY20 的 tile 种类远少于 C:S 的 182 类，因此按 5 个服务类别建账；
分片、日结算、贷款摊销、税率作用域这些**机制**与 C:S 一致。
"""

from dataclasses import dataclass, field
from enum import StrEnum

# C:S: 16 段 × 16 帧 = 256 帧一日；与 SimulationManager 的 `frame & 0xFF` 一致
SEGMENTS_PER_DAY = 16
FRAMES_PER_SEGMENT = 16
FRAMES_PER_DAY = SEGMENTS_PER_DAY * FRAMES_PER_SEGMENT  # 256


class Service(StrEnum):
    """账本的服务类别（C:S 是 service × subService × level 三档）。"""

    RESIDENTIAL = "residential"
    COMMERCIAL = "commercial"
    INDUSTRIAL = "industrial"
    OFFICE = "office"
    UTILITY = "utility"  # 道路/地铁/桥等基础设施


# 税率默认值（百分点）。C:S 默认 9%，区间 1..29。
DEFAULT_TAX_RATE = 9
MIN_TAX_RATE = 1
MAX_TAX_RATE = 29
# 区政策对税率的固定修正（C:S `Taxation.TaxRaiseResLow` = ±2）
POLICY_TAX_DELTA = 2


@dataclass
class Loan:
    """一笔贷款。按剩余期数摊销（C:S `EconomyManager` 的 Loan 结构）。"""

    principal: int
    remaining: int
    rate_bp: int  # 年化基点，例如 500 = 5%
    months: int
    months_left: int

    def monthly_interest(self) -> int:
        """当期利息 = 剩余本金 × 年化利率 / 12（整数元）。"""
        return round(self.remaining * self.rate_bp / 10_000 / 12)

    def monthly_payment(self) -> int:
        """当期应还 = 剩余本金 / 剩余期数 + 当期利息。"""
        if self.months_left <= 0:
            return self.remaining
        return min(self.remaining, round(self.remaining / self.months_left) + self.monthly_interest())

    def repay_month(self) -> int:
        """还一个月，返回本期实际扣款。"""
        payment = self.monthly_payment()
        self.remaining = max(0, self.remaining - payment)
        self.months_left = max(0, self.months_left - 1)
        return payment


@dataclass
class DaySettlement:
    """一天结束时的结算结果。"""

    day: int
    income: dict[str, int]
    expenses: dict[str, int]
    loan_payment: int
    net: int


@dataclass
class CityBudget:
    """16 段日分片的市政账本。"""

    income: dict[str, list[int]] = field(default_factory=dict)
    expenses: dict[str, list[int]] = field(default_factory=dict)
    tax_rates: dict[str, int] = field(default_factory=dict)
    loans: list[Loan] = field(default_factory=list)
    day_income: dict[str, int] = field(default_factory=dict)
    day_expenses: dict[str, int] = field(default_factory=dict)
    # C:S 的 m_serviceBudgetDay / m_serviceBudgetNight：夜间维护单独记一份
    night_expenses: int = 0
    last_day: int = -1

    def __post_init__(self) -> None:
        for service in Service:
            self.income.setdefault(service.value, [0] * SEGMENTS_PER_DAY)
            self.expenses.setdefault(service.value, [0] * SEGMENTS_PER_DAY)
            self.tax_rates.setdefault(service.value, DEFAULT_TAX_RATE)
            self.day_income.setdefault(service.value, 0)
            self.day_expenses.setdefault(service.value, 0)

    # ---- 分段记账 ----
    @staticmethod
    def segment_of(frame: int) -> int:
        """帧号 → 当日第几段（0..15），与 C:S `(frame >> 8) & 0xF` 同构。"""
        return (frame // FRAMES_PER_SEGMENT) % SEGMENTS_PER_DAY

    def add_income(self, service: Service, amount: int, frame: int) -> None:
        if amount <= 0:
            return
        self.income[service.value][self.segment_of(frame)] += amount

    def add_expense(self, service: Service, amount: int, frame: int, *, night: bool = False) -> None:
        if amount <= 0:
            return
        self.expenses[service.value][self.segment_of(frame)] += amount
        if night:
            self.night_expenses += amount

    # ---- 税率 ----
    def tax_rate(self, service: Service, policy_delta: int = 0) -> int:
        """基础税率 + 政策修正，夹在 [1, 29]。"""
        base = self.tax_rates.get(service.value, DEFAULT_TAX_RATE)
        return max(MIN_TAX_RATE, min(MAX_TAX_RATE, base + policy_delta))

    def set_tax_rate(self, service: Service, rate: int) -> int:
        clamped = max(MIN_TAX_RATE, min(MAX_TAX_RATE, rate))
        self.tax_rates[service.value] = clamped
        return clamped

    # ---- 日结算 ----
    def settle_day(self, frame: int, funds: int) -> DaySettlement:
        """每 256 帧调用：汇总 16 段、还贷款、算出当日净额。

        `frame & 0xFF == 255` 是 C:S 的日界（一日的最后一段结束）。
        """
        day = frame // FRAMES_PER_DAY
        income = {s.value: sum(self.income[s.value]) for s in Service}
        expenses = {s.value: sum(self.expenses[s.value]) for s in Service}

        loan_payment = 0
        # C:S 按月结算贷款；CITY20 一年 12 个月 → 每 30 日一次
        if day % 30 == 0:
            for loan in self.loans:
                loan_payment += loan.repay_month()
            self.loans = [loan for loan in self.loans if loan.remaining > 0]

        net = sum(income.values()) - sum(expenses.values()) - loan_payment
        for service in Service:
            self.income[service.value] = [0] * SEGMENTS_PER_DAY
            self.expenses[service.value] = [0] * SEGMENTS_PER_DAY
        self.day_income = income
        self.day_expenses = expenses
        self.last_day = day
        return DaySettlement(
            day=day, income=income, expenses=expenses, loan_payment=loan_payment, net=net
        )

    # ---- 贷款 ----
    def take_loan(self, principal: int, rate_bp: int, months: int) -> Loan:
        loan = Loan(
            principal=principal,
            remaining=principal,
            rate_bp=rate_bp,
            months=months,
            months_left=months,
        )
        self.loans.append(loan)
        return loan

    def total_debt(self) -> int:
        return sum(loan.remaining for loan in self.loans)

    # ---- 快照 ----
    def to_snapshot(self) -> dict:
        return {
            "income": self.income,
            "expenses": self.expenses,
            "tax_rates": self.tax_rates,
            "loans": [
                {
                    "principal": loan.principal,
                    "remaining": loan.remaining,
                    "rate_bp": loan.rate_bp,
                    "months": loan.months,
                    "months_left": loan.months_left,
                }
                for loan in self.loans
            ],
            "day_income": self.day_income,
            "day_expenses": self.day_expenses,
            "last_day": self.last_day,
        }

    @classmethod
    def from_snapshot(cls, data: dict) -> "CityBudget":
        budget = cls()
        budget.income = {k: list(v) for k, v in data.get("income", {}).items()} or budget.income
        budget.expenses = {
            k: list(v) for k, v in data.get("expenses", {}).items()
        } or budget.expenses
        budget.tax_rates.update(data.get("tax_rates", {}))
        budget.loans = [Loan(**item) for item in data.get("loans", [])]
        budget.day_income.update(data.get("day_income", {}))
        budget.day_expenses.update(data.get("day_expenses", {}))
        budget.last_day = int(data.get("last_day", -1))
        # 补齐缺失的服务键（旧存档可能只有部分类别）
        for service in Service:
            budget.income.setdefault(service.value, [0] * SEGMENTS_PER_DAY)
            budget.expenses.setdefault(service.value, [0] * SEGMENTS_PER_DAY)
            budget.tax_rates.setdefault(service.value, DEFAULT_TAX_RATE)
            budget.day_income.setdefault(service.value, 0)
            budget.day_expenses.setdefault(service.value, 0)
        return budget

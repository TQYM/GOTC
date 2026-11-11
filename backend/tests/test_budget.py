"""预算系统：16 段日分片、税率、贷款摊销（对齐 C:S EconomyManager 的机制）。"""

from app.sim.budget import (
    DEFAULT_TAX_RATE,
    FRAMES_PER_DAY,
    MAX_TAX_RATE,
    MIN_TAX_RATE,
    SEGMENTS_PER_DAY,
    CityBudget,
    Loan,
    Service,
)


def test_segment_mapping_matches_frame_division():
    """帧号 → 当日分段，与 C:S 的 (frame >> 8) & 0xF 同构。"""
    assert CityBudget.segment_of(0) == 0
    assert CityBudget.segment_of(15) == 0
    assert CityBudget.segment_of(16) == 1
    assert CityBudget.segment_of(255) == SEGMENTS_PER_DAY - 1
    assert CityBudget.segment_of(256) == 0
    assert CityBudget.segment_of(FRAMES_PER_DAY + 32) == 2


def test_income_lands_in_the_right_segment():
    budget = CityBudget()
    budget.add_income(Service.RESIDENTIAL, 100, frame=0)
    budget.add_income(Service.RESIDENTIAL, 50, frame=32)  # 第 2 段
    assert budget.income[Service.RESIDENTIAL.value][0] == 100
    assert budget.income[Service.RESIDENTIAL.value][2] == 50


def test_settle_day_sums_segments_and_resets():
    budget = CityBudget()
    for i in range(SEGMENTS_PER_DAY):
        budget.add_income(Service.RESIDENTIAL, 10, frame=i * 16)
        budget.add_expense(Service.UTILITY, 3, frame=i * 16)
    settlement = budget.settle_day(frame=FRAMES_PER_DAY - 1, funds=0)
    assert settlement.income[Service.RESIDENTIAL.value] == 10 * SEGMENTS_PER_DAY
    assert settlement.expenses[Service.UTILITY.value] == 3 * SEGMENTS_PER_DAY
    assert settlement.net == 10 * SEGMENTS_PER_DAY - 3 * SEGMENTS_PER_DAY
    # 汇总后当天分段清零
    assert sum(budget.income[Service.RESIDENTIAL.value]) == 0


def test_tax_rate_is_clamped():
    budget = CityBudget()
    assert budget.set_tax_rate(Service.RESIDENTIAL, 0) == MIN_TAX_RATE
    assert budget.set_tax_rate(Service.RESIDENTIAL, 999) == MAX_TAX_RATE
    assert budget.set_tax_rate(Service.RESIDENTIAL, 12) == 12
    assert budget.tax_rate(Service.COMMERCIAL) == DEFAULT_TAX_RATE


def test_policy_delta_is_applied_on_top_of_base():
    budget = CityBudget()
    budget.set_tax_rate(Service.RESIDENTIAL, 9)
    assert budget.tax_rate(Service.RESIDENTIAL, policy_delta=2) == 11
    assert budget.tax_rate(Service.RESIDENTIAL, policy_delta=-2) == 7
    # 夹取发生在叠加之后
    budget.set_tax_rate(Service.RESIDENTIAL, MAX_TAX_RATE)
    assert budget.tax_rate(Service.RESIDENTIAL, policy_delta=2) == MAX_TAX_RATE


def test_loan_amortises_by_remaining_periods():
    loan = Loan(principal=120_000, remaining=120_000, rate_bp=0, months=12, months_left=12)
    assert loan.monthly_payment() == 10_000
    assert loan.repay_month() == 10_000
    assert loan.remaining == 110_000
    assert loan.months_left == 11


def test_loan_interest_shrinks_with_balance():
    loan = Loan(principal=120_000, remaining=120_000, rate_bp=1200, months=12, months_left=12)
    first = loan.monthly_interest()
    loan.remaining = 60_000
    second = loan.monthly_interest()
    assert first == round(120_000 * 0.12 / 12)
    assert second < first


def test_loan_is_repaid_on_thirty_day_boundary():
    budget = CityBudget()
    budget.take_loan(60_000, rate_bp=0, months=6)
    # 第 0 日（day=0）结算一次
    first = budget.settle_day(frame=FRAMES_PER_DAY - 1, funds=0)
    assert first.loan_payment == 10_000
    # 第 1 日不还
    second = budget.settle_day(frame=FRAMES_PER_DAY * 2 - 1, funds=0)
    assert second.loan_payment == 0


def test_budget_round_trips_through_snapshot():
    budget = CityBudget()
    budget.add_income(Service.COMMERCIAL, 42, frame=16)
    budget.set_tax_rate(Service.INDUSTRIAL, 7)
    budget.take_loan(30_000, rate_bp=400, months=24)
    restored = CityBudget.from_snapshot(budget.to_snapshot())
    assert restored.income[Service.COMMERCIAL.value][1] == 42
    assert restored.tax_rates[Service.INDUSTRIAL.value] == 7
    assert restored.total_debt() == 30_000

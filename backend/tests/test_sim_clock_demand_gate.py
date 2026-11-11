"""C:S 结构复刻的单元测试：帧时钟 / 需求双轨 / 建造闸门。"""

from app.sim.clock import SPEED_FRAMES, SimulationClock
from app.sim.demand import Demand
from app.sim.gate import BuildGate


def test_paused_returns_substep_zero_and_does_not_advance():
    clock = SimulationClock(speed=0)
    steps = clock.advance()
    assert steps == [0]
    assert clock.frame == 0


def test_speed_three_runs_four_frames():
    """C:S 的 3x 档实际是 4 帧，复刻不能"修正"成 3。"""
    clock = SimulationClock(speed=3)
    assert SPEED_FRAMES[3] == 4
    steps = clock.advance()
    assert steps == [1, 2, 3, 4]
    assert clock.frame == 4


def test_speed_one_runs_single_substep_from_one():
    clock = SimulationClock(speed=1)
    assert clock.advance() == [1]
    assert clock.frame == 1


def test_year_and_day_are_derived_from_frame():
    clock = SimulationClock(frame=0)
    assert (clock.year, clock.day) == (1, 1)
    clock.frame = clock.frames_per_year
    assert clock.year == 2
    clock.frame = clock.frames_per_day
    assert clock.day == 2


def test_demand_actual_vs_displayed_diverge_then_converge():
    demand = Demand()
    demand.recompute(
        population=800,
        housing_capacity=1000,
        jobs=800,
        workforce=1200,
        commercial_capacity=200,
    )
    # 新语义：住宅需求 = 空置率（800/1000 已住 → +0.2）；真值立刻更新，显示值仍是 0
    assert demand.actual_residential > 0
    assert demand.displayed_residential == 0.0

    for _ in range(80):
        demand.smooth()

    assert abs(demand.displayed_residential - demand.actual_residential) < 0.01
    assert abs(demand.displayed_commercial - demand.actual_commercial) < 0.01
    assert abs(demand.displayed_workplace - demand.actual_workplace) < 0.01


def test_demand_ui_maps_minus_one_to_zero():
    assert Demand.to_ui(-1.0) == 0
    assert Demand.to_ui(0.0) == 50
    assert Demand.to_ui(1.0) == 100


def test_build_gate_allows_one_per_window():
    gate = BuildGate(open_interval=8)
    allowed = [gate.can_build(frame) for frame in range(16)]
    # 第 0 帧与第 8 帧各开一次，其余关闭
    assert allowed == [True, False, False, False, False, False, False, False,
                       True, False, False, False, False, False, False, False]


def test_build_gate_rate_is_constant_regardless_of_speed():
    gate = BuildGate(open_interval=8)
    assert gate.rate_per_year(3600) == 450.0

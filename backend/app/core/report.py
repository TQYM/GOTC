"""终局结构化报告的模板生成（04 §6 report 组）。

放在 core 而非 narrate：session.finalize 必须在不依赖叙述层的情况下产出报告（分层纪律）。
数值全部来自引擎推演结果；模板只负责组织语言。PR-12 的 AI 版在 narrate 层覆盖 source=ai。
"""

from app.contracts.common import Source
from app.contracts.events import Report, ReportDimensions
from app.contracts.finalize import Ending, Scores
from app.contracts.metrics import Metrics
from app.core.personas import ENDING_NAMES

_DIM_COMMENTS = {
    "population": ("人口规模", "人口导入得力，城区人气足", "人口导入不足，需要完善居住与配套"),
    "balance": ("职住平衡", "职住比例协调，通勤结构健康", "职住比例失衡，居住与就业应同步布局"),
    "green": ("绿地系统", "绿地网络成型，生态本底良好", "绿地总量不足，应沿绿线补绿织网"),
    "traffic": ("交通运行", "通勤与拥堵控制良好", "通勤与拥堵压力较大，需优化路网与轨道"),
    "happiness": ("居民幸福", "居民满意度高", "居民满意度偏低，需从绿地通勤污染入手"),
}

_ENDING_STORIES = {
    Ending.BANKRUPT: "十年后，财政收支失衡，维护费压垮了账面。"
    "城市不是一天衰败的：早年重资产上马、税收培育不足，现金流年复一年失血。"
    "若重来一次，应先轻后重，用住宅与商业滚动积累，再上大项目。",
    Ending.ECO_PARADISE: "十年后，这里成了远近闻名的生态乌托邦。绿道成网、河道清澈，"
    "没有工业烟尘，居民推窗见绿。"
    "城市证明了另一种发展观：把自然当本金而非成本，宜居本身就是最持久的竞争力。",
    Ending.GRIDLOCK: "十年后，早晚高峰成了市民的集体记忆。道路负荷连年超载，通勤时间居高不下。"
    "城市并未停止生长，只是生长的速度超过了血管的承受力。若重来一次，轨道与职住应先行一步。",
    Ending.GHOST_TOWN: "十年后，楼宇依旧，人烟稀薄。规划容量远超真实入住，商铺关门、楼道空寂。"
    "空城的出现从不是偶然：缺乏就业与配套的房子，终究只是钢筋水泥。若重来一次，先把岗位和服务做扎实。",
    Ending.THRIVING: "十年后，这座城成为教科书里的明日之城：职住平衡、通勤顺畅、幸福度高企。"
    "它的成功没有秘密——住宅、就业、公共服务与绿地在每一年都保持了同步的节奏。规划的价值，正在于此。",
    Ending.ORDINARY: "十年后，这座城平淡地运转着：没有亮眼的奇迹，也没有失控的危机。"
    "它是千百万普通城市的缩影，各项指标差强人意。若重来一次，在绿地、通勤与职住之间再精细一些，平凡也能走向优秀。",
}


def report_length(report: Report) -> int:
    """三段式总字数（DoD：400–700 字）。"""
    dims = report.dimensions
    return len(report.overview) + len(report.ending_story) + sum(
        len(getattr(dims, key)) for key in _DIM_COMMENTS
    )


def build_template_report(
    city_name: str, metrics: Metrics, scores: Scores, ending: Ending
) -> Report:
    """三段式：overview 总体诊断 / dimensions 五维逐项 / ending_story 结局故事。"""
    overview = (
        f"{city_name}以{metrics.population}人、{metrics.jobs}个岗位的规模走完推演，"
        f"期末财政{metrics.funds}元，年税收{metrics.tax_income}元、年维护{metrics.upkeep}元。"
        f"绿地率{metrics.green_ratio:.2f}，平均通勤{metrics.avg_commute}分钟，"
        f"拥堵指数{metrics.congestion:.2f}，污染指数{metrics.pollution:.2f}，"
        f"幸福度{metrics.happiness}分，职住比{metrics.job_res_ratio:.2f}。"
        f"教育覆盖率{metrics.coverage_edu:.0%}、医疗覆盖率{metrics.coverage_med:.0%}，"
        f"地价指数{metrics.land_price_index:.1f}。"
        "从账面到体感，这是一份可以被逐项复核的成绩单，每一分钱、每一分钟都来自模拟引擎的逐年推演。"
        "五个维度相互牵制：人口带来税收也带来通勤，工业带来岗位也带来污染，"
        "绿地看似不创收，却同时抬升幸福度与地价。优秀的规划不是单项冠军，而是让五根指针同向。"
    )
    score_map = {
        "population": scores.population,
        "balance": scores.balance,
        "green": scores.green,
        "traffic": scores.traffic,
        "happiness": scores.happiness,
    }
    dims = {}
    for key, (label, good, bad) in _DIM_COMMENTS.items():
        score = score_map[key]
        dims[key] = f"{label}{score}分：{good if score >= 60 else bad}。"
    ending_story = (
        f"【{ENDING_NAMES[ending.value]}】"
        + _ENDING_STORIES[ending]
        + "本报告由规则模板生成；接入规划导师后，将以同样的三段式结构给出更细腻的叙事。"
    )
    return Report(
        overview=overview,
        dimensions=ReportDimensions(**dims),
        ending_story=ending_story,
        source=Source.TEMPLATE,
    )

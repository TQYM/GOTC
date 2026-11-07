"""降级模板槽位库（04 §6）：news / citizen / mentor / report 四组，全部纯规则。

AI 成功用 AI 文案，失败/超时/解析失败一律落到这里；玩家体验差别只是文采。
"""

from app.contracts.finalize import Ending, Scores
from app.contracts.metrics import Metrics
from app.core.personas import ENDING_NAMES, METRIC_NAMES, TILE_NAMES

# ---- news（04 §6：【指标名】升至/降至【值】，主要受【区块类型】影响） ----


def render_news(metric: str, value: float, *, up: bool, cause_tile: str, severity: str) -> dict:
    name = METRIC_NAMES.get(metric, metric)
    cause = TILE_NAMES.get(cause_tile, cause_tile)
    direction = "升至" if up else "降至"
    headline = f"{name}{direction}{value}"[:20]
    body = f"【{name}】{direction}【{value}】，主要受【{cause}】影响。"[:80]
    return {"headline": headline, "body": body, "severity": severity}


# ---- citizen：sentiment × topic 双键查表，槽位 {place}/{value} ----

CITIZEN_TEMPLATES: dict[str, dict[str, tuple[str, ...]]] = {
    "angry": {
        "commute": (
            "每天堵在{place}，市长你开开车试试？😡",
            "@市长 {place}又堵了，通勤{value}分钟谁受得了！",
        ),
        "edu": (
            "孩子上学跑{place}那么远，学校呢？😤",
            "@市长 学位太紧张了，{place}的家长都急疯了！",
        ),
        "med": ("生个病要跨半个城去{place}，要命哦！", "@市长 {place}附近连医院都没有吗？"),
        "green": ("{place}的树都没了，灰头土脸的🌳😢", "@市长 还我{place}的绿地！"),
        "price": (
            "{place}地价都{value}了，租不起了😮‍💨",
            "@市长 {place}的店铺租金涨疯了，小店怎么活？",
        ),
        "pollution": ("{place}呛得慌，窗户都不敢开😷", "@市长 {place}的工厂管不管了！"),
    },
    "happy": {
        "commute": ("{place}通勤只要{value}分钟，幸福🚇", "@市长 {place}新路好走，点赞！"),
        "edu": ("{place}学校就在家门口，娃开心👶🏫", "@市长 {place}新学校真不错！"),
        "med": ("{place}看病方便多了，安心❤️", "@市长 {place}新医院给力！"),
        "green": ("{place}的公园太舒服了🌳✨", "@市长 多去{place}走走，心情好！"),
        "price": ("{place}生意越来越好，地价{value}也值了💰", "@市长 {place}旺起来了！"),
        "pollution": ("{place}空气清新多了😊", "@市长 {place}环境整治有成效！"),
    },
    "neutral": {
        "commute": ("{place}通勤{value}分钟，还行吧。", "@市长 {place}早晚高峰再优化下？"),
        "edu": ("{place}上学距离一般，凑合。", "@市长 {place}的学校再多点选择？"),
        "med": ("{place}看病不算远也不近。", "@市长 {place}医疗配套观望中。"),
        "green": ("{place}绿化一般般。", "@市长 {place}能不能多栽点树？"),
        "price": ("{place}地价{value}，观望中。", "@市长 {place}租金别再涨了哦。"),
        "pollution": ("{place}空气还过得去。", "@市长 {place}环保继续盯紧点。"),
    },
}


def render_citizen(
    sentiment: str, topic: str, *, variant: int = 0, place: str = "城区", value: str = ""
) -> dict:
    """双键查表 + 槽位填充；variant 由调用方确定性给出，避免复读。"""
    variants = CITIZEN_TEMPLATES[sentiment][topic]
    text = variants[variant % len(variants)].format(place=place, value=value)
    return {"text": text[:60], "sentiment": sentiment, "topic": topic}


# ---- mentor：Top 指标问题 → 规则库（theory_refs 只用允许值） ----

# (判定, comment, theory_refs, severity)
MENTOR_RULES = (
    (
        lambda m: m.green_ratio < 0.25,
        "绿地率低于 GB50180 新建城区 0.30 的要求，建议沿河道绿线补公园与广场，先织绿网再谈密度。",
        ["green_network"],
        "warning",
    ),
    (
        lambda m: m.congestion > 0.6,
        "拥堵指数偏高，干道能力吃紧。请梳理道路等级体系，让省道承担过境、支路服务到发。",
        ["road_hierarchy"],
        "warning",
    ),
    (
        lambda m: m.avg_commute > 40,
        "平均通勤超过 40 分钟，建议在居住区 600m 内布局地铁站，用 TOD 把通勤压回 30 分钟圈。",
        ["tod"],
        "warning",
    ),
    (
        lambda m: m.job_res_ratio < 0.6 or m.job_res_ratio > 1.5,
        "职住比偏离 0.85–1.15 的平衡区间，居住与就业要同步布局，避免卧城或空城。",
        ["jobs_housing_balance"],
        "warning",
    ),
    (
        lambda m: m.coverage_edu < 0.6 or m.coverage_med < 0.6,
        "学校/医院覆盖率不足，按 GB50180 15 分钟生活圈补齐公共服务，优先补在住宅 600m 范围。",
        ["life_circle_15"],
        "warning",
    ),
    (
        lambda m: m.pollution > 0.3,
        "住宅污染暴露偏高，工业与居住之间要留防护绿带，重工业尽量下风下水。",
        ["green_network"],
        "warning",
    ),
)

MENTOR_DEFAULT = {
    "comment": "布局结构总体均衡，各项指标在合理区间。下一步可做小尺度织补，保持职住与配套同步。",
    "theory_refs": ["life_circle_15"],
    "severity": "info",
}


def render_mentor(metrics: Metrics) -> dict:
    """首个命中规则即返回（04 §4 先肯定再指出问题由 AI 版润色，模板直给）。"""
    for condition, comment, refs, severity in MENTOR_RULES:
        if condition(metrics):
            return {"comment": comment[:120], "theory_refs": refs, "severity": severity}
    return dict(MENTOR_DEFAULT)


def render_mentor_top3(metrics: Metrics) -> list[dict]:
    """polish 期 Top3 结构问题（04 §4）。"""
    issues = [
        {"comment": c[:120], "theory_refs": r, "severity": "warning"}
        for condition, c, r, _ in MENTOR_RULES
        if condition(metrics)
    ]
    return issues[:3]


# ---- report：三段式纯规则模板（400–700 字） ----

_DIM_COMMENTS = {
    "population": ("人口规模", "人口导入得力，城区人气足", "人口导入不足，需要完善居住与配套"),
    "balance": ("职住平衡", "职住比例协调，通勤结构健康", "职住比例失衡，居住与就业应同步布局"),
    "green": ("绿地系统", "绿地网络成型，生态本底良好", "绿地总量不足，应沿绿线补绿织网"),
    "traffic": ("交通运行", "通勤与拥堵控制良好", "通勤与拥堵压力较大，需优化路网与轨道"),
    "happiness": ("居民幸福", "居民满意度高", "居民满意度偏低，需从绿地通勤污染入手"),
}

_ENDING_STORIES = {
    Ending.BANKRUPT: "十年后，财政收支失衡，维护费压垮了账面。"
        "城市不是一天衰败的：早年重资产上马、税收培育不足，现金流年复一年失血。若重来一次，应先轻后重，用住宅与商业滚动积累，再上大项目。",
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


def render_report(metrics: Metrics, scores: Scores, ending: Ending) -> str:
    """三段式：总体诊断 → 五维逐项点评 → 结局故事。400–700 字。"""
    para1 = (
        f"【总体诊断】这座城市以{metrics.population}人、{metrics.jobs}个岗位的规模走完推演，"
        f"期末财政{metrics.funds}元，年税收{metrics.tax_income}元、年维护{metrics.upkeep}元。"
        f"绿地率{metrics.green_ratio:.2f}，平均通勤{metrics.avg_commute}分钟，"
        f"拥堵指数{metrics.congestion:.2f}，污染指数{metrics.pollution:.2f}，"
        f"幸福度{metrics.happiness}分，职住比{metrics.job_res_ratio:.2f}。"
        f"教育覆盖率{metrics.coverage_edu:.0%}、医疗覆盖率{metrics.coverage_med:.0%}，"
        f"地价指数{metrics.land_price_index:.1f}。"
        "从账面到体感，这是一份可以被逐项复核的成绩单，每一分钱、每一分钟都来自模拟引擎的逐年推演。"
    )
    score_map = {
        "population": scores.population,
        "balance": scores.balance,
        "green": scores.green,
        "traffic": scores.traffic,
        "happiness": scores.happiness,
    }
    parts = ["【五维点评】"]
    for key, (label, good, bad) in _DIM_COMMENTS.items():
        score = score_map[key]
        verdict = good if score >= 60 else bad
        parts.append(f"{label}{score}分：{verdict}。")
    parts.append(
        "五个维度相互牵制：人口带来税收也带来通勤，工业带来岗位也带来污染，"
        "绿地看似不创收，却同时抬升幸福度与地价。优秀的规划不是单项冠军，而是让五根指针同向。"
    )
    para2 = "".join(parts)
    para3 = (
        f"【结局故事·{ENDING_NAMES[ending.value]}】"
        + _ENDING_STORIES[ending]
        + "本报告由规则模板生成；接入规划导师后，将以同样的三段式结构给出更细腻的叙事。"
    )
    return para1 + "\n" + para2 + "\n" + para3

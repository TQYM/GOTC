"""静态素材（06 §2）：市民人设与导师理论库。数值一律来自引擎，这里只有文案素材。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    key: str
    name: str
    topics: tuple[str, ...]  # 敏感话题（04 §3：按指标敏感度匹配人设）
    style: str  # 口吻提示（供 prompt 与模板选择）


PERSONAS: dict[str, Persona] = {
    "li": Persona("li", "程序员小李", ("commute", "pollution"), "打工人吐槽，爱用🚇💻"),
    "wang": Persona("wang", "带娃妈妈王姐", ("edu", "med"), "操心孩子，爱用👶🏫"),
    "zhou": Persona("zhou", "个体户老周", ("price",), "关心租金生意，爱用💰🏪"),
    "chen": Persona("chen", "退休教师陈伯", ("green", "pollution"), "要绿地要安静，爱用🌳"),
    "zi": Persona("zi", "外地租客阿紫", ("price", "commute"), "房租房价敏感，爱用🏠😮‍💨"),
}

TOPICS = ("commute", "edu", "med", "green", "price", "pollution")
SENTIMENTS = ("angry", "happy", "neutral")

# 导师理论库（02 §3.8 mentor.theory_refs 只允许这五个值）
THEORY_REFS = {
    "tod": "TOD 公共交通导向开发",
    "life_circle_15": "GB50180 15 分钟生活圈",
    "jobs_housing_balance": "职住平衡",
    "green_network": "绿道系统 / GB50180 绿地条款",
    "road_hierarchy": "道路等级体系",
}

# 指标中文名（模板槽位用）
METRIC_NAMES = {
    "population": "人口",
    "jobs": "岗位",
    "job_res_ratio": "职住比",
    "land_price_index": "地价指数",
    "green_ratio": "绿地率",
    "avg_commute": "平均通勤",
    "congestion": "拥堵指数",
    "pollution": "污染指数",
    "happiness": "幸福度",
    "tax_income": "年税收",
    "upkeep": "年维护费",
    "coverage_edu": "教育覆盖率",
    "coverage_med": "医疗覆盖率",
    "funds": "财政资金",
}

TILE_NAMES = {
    "res_low": "低层住宅",
    "res_mid": "多层住宅",
    "res_high": "高层住宅",
    "com_shop": "便利店",
    "com_cbd": "CBD",
    "ind_light": "轻工业",
    "ind_heavy": "重工业",
    "trans_road": "道路",
    "trans_avenue": "城市大道",
    "trans_highway": "城市高速",
    "trans_metro": "地铁站",
    "util_bridge": "跨河桥",
    "green_park": "公园",
    "green_plaza": "广场",
    "edu_school": "学校",
    "med_clinic": "医院",
}

ENDING_NAMES = {
    "bankrupt": "财政破产",
    "eco_paradise": "生态乌托邦",
    "gridlock": "拥堵之城",
    "ghost_town": "鬼城",
    "thriving": "明日之城",
    "ordinary": "平凡之城",
}

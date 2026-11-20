#!/usr/bin/env python3
"""生成自建工作台 data/custom-workbenches.json。

技能清单从本机 ~/.dsh/skills 的真实 SKILL.md frontmatter 读取，
摘要截取 description 的第一句，避免手写内容与实际技能不符。
"""
import json
import re
from pathlib import Path

SKILLS_DIR = Path.home() / ".dsh" / "skills"
# 输出到本脚本所在目录，跟着插件走
OUT = Path(__file__).resolve().parent / "custom-workbenches.json"


def read_skill(slug):
    """读 SKILL.md 的 name/description，返回 (title, summary) 或 None。"""
    path = SKILLS_DIR / slug / "SKILL.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    front = text[3:end] if end != -1 else text[3:3000]

    desc = ""
    # description: > 折叠块 或 description: "一行"
    m = re.search(r"^description:\s*[>|]-?\s*\n((?:(?:[ \t]+.*)?\n)+)", front, re.M)
    if m:
        desc = " ".join(line.strip() for line in m.group(1).splitlines() if line.strip())
    else:
        m = re.search(r'^description:\s*(.+)$', front, re.M)
        if m:
            desc = m.group(1).strip().strip('"').strip("'")

    name_m = re.search(r"^name:\s*(.+)$", front, re.M)
    name = name_m.group(1).strip() if name_m else slug

    desc = re.sub(r"\s+", " ", desc).strip()
    # 第一句：优先中文句号/问号，其次英文句点
    cut = re.split(r"(?<=[。！？])", desc, maxsplit=1)[0]
    if cut == desc:
        cut = re.split(r"(?<=\.)\s", desc, maxsplit=1)[0]
    summary = cut.strip()
    if len(summary) > 150:
        summary = summary[:148] + "…"
    return name, summary


# 技能分组：按开发阶段归类，每组的说明写进提示词，技能按组顺序列出。

# 技能的中文显示名：面板上全是 slug 读起来太吃力。
TITLES = {
    "game-design": "游戏设计（概念/世界/关卡/叙事/美术方向）",
    "game-designer": "游戏系统与玩法机制设计",
    "game-ui-product-design": "GDD/PRD 与交互逻辑",
    "game-ui-specification": "游戏 UI 规范与视觉契约",
    "level-design": "关卡设计（度量/门禁/节奏）",
    "router": "游戏开发技能路由",
    "platformer": "平台跳跃玩法",
    "roguelike": "Roguelike 局内与元进度",
    "rpg": "RPG 数值与装备",
    "tower-defense": "塔防（路径/波次/经济）",
    "card-game": "卡牌与构筑",
    "puzzle": "网格与逻辑谜题",
    "fps-shooter": "FPS 射击手感",
    "survival-crafting": "生存建造",
    "visual-novel": "视觉小说",
    "dialogue-systems": "分支对话",
    "game-ai": "敌人与 NPC AI",
    "ai-behavior-trees-utility-ai": "行为树与效用 AI",
    "procedural-gen": "程序化生成",
    "godot-nodes-scenes": "Godot 场景与节点",
    "godot-gdscript": "GDScript 2.0",
    "godot-game-script-engineer": "Godot 玩法脚本工程",
    "godot-signals-groups": "信号与节点组",
    "godot-resources": "自定义 Resource 数据驱动",
    "godot-csharp": "Godot C#",
    "godot-2d-movement": "2D 角色移动",
    "godot-physics": "物理与碰撞",
    "godot-tilemap": "瓦片地图",
    "godot-animation": "动画",
    "godot-3d-essentials": "3D 场景基础",
    "godot-ui-control": "Control UI",
    "godot-shaders": "Godot 着色器",
    "godot-audio": "Godot 音频",
    "godot-multiplayer": "联机",
    "input-systems": "输入系统与按键重绑",
    "camera-systems": "摄像机",
    "save-systems": "存档系统",
    "physics-tuning": "物理调参",
    "game-feel": "手感与打击感",
    "game-ui-ux": "游戏 UI/UX 规则",
    "audio-design": "音频设计（总线/混音/自适应）",
    "performance-optimization": "性能分析与优化",
    "shader-programming": "着色器原理",
    "create-game-assets": "游戏美术资产生产",
    "game-ui-workflow": "游戏 UI 全流程编排",
    "game-ui-extension": "界面系统扩展",
    "game-ui-page-generator": "页面设计生成",
    "game-ui-component-breakdown": "组件拆解",
    "game-ui-sprite-sheet-splitter": "图集拆分",
    "game-ui-asset-pipeline": "图集打包与引擎交付",
    "game-build": "游戏构建执行",
    "godot-gdscript-headless-testing": "无头测试与 CI",
    "game-qa": "实机盲玩验收",
    "godot-export": "导出与发布",
    "dev-god": "高阶全栈编程",
    "dev-expert": "编程专家",
    "dev-expert-pro": "编程专家 Pro",
    "skill-creator": "技能编写",
}

GROUPS = [
    ("立项与设计", [
        "game-design", "game-designer", "game-ui-product-design", "game-ui-specification",
        "level-design", "router",
    ]),
    ("类型化玩法设计", [
        "platformer", "roguelike", "rpg", "tower-defense", "card-game", "puzzle",
        "fps-shooter", "survival-crafting", "visual-novel", "dialogue-systems",
        "game-ai", "ai-behavior-trees-utility-ai", "procedural-gen",
    ]),
    ("Godot 工程骨架", [
        "godot-nodes-scenes", "godot-gdscript", "godot-game-script-engineer",
        "godot-signals-groups", "godot-resources", "godot-csharp",
    ]),
    ("Godot 玩法实现", [
        "godot-2d-movement", "godot-physics", "godot-tilemap", "godot-animation",
        "godot-3d-essentials", "godot-ui-control", "godot-shaders", "godot-audio",
        "godot-multiplayer", "input-systems", "camera-systems", "save-systems",
        "physics-tuning",
    ]),
    ("手感与体验", [
        "game-feel", "game-ui-ux", "audio-design", "performance-optimization",
        "shader-programming",
    ]),
    ("美术资产", [
        "create-game-assets", "game-ui-workflow", "game-ui-extension",
        "game-ui-page-generator", "game-ui-component-breakdown",
        "game-ui-sprite-sheet-splitter", "game-ui-asset-pipeline",
    ]),
    ("构建、测试与发布", [
        "game-build", "godot-gdscript-headless-testing", "game-qa", "godot-export",
    ]),
    ("通用工程", [
        "dev-god", "dev-expert", "dev-expert-pro", "skill-creator",
    ]),
]

INSTRUCTION = """你是这个工作台里的 Godot 游戏开发负责人。目标是把一个想法推进到**能跑、能验证、能交付**的 Godot 项目，而不是交出一堆看起来正确的代码。

## 环境事实（本机实测，不要凭印象改）

- 引擎：Godot **4.7.2-stable**（`D:/Dev Tools/Godot/Godot_v4.7.2-stable_win64.exe`；读日志用同目录 `*_console.exe`）。
- 项目格式：`config_version=5`，`config/features` 里写 `"4.7"`。写 4.0/4.2 的 API 会直接不认。
- 本机已有工程都在 `D:/Workspace/Games/<项目名>/`，一个项目一个子目录、各自带 `.git`。
- 桌面渲染默认 `GL Compatibility` 即可；需要 3D 高级效果时再评估。

## 工作顺序（不要跳步）

1. **先定问题，再动代码。** 明确一句话核心循环、目标平台、操作方式、失败条件。含糊就先用 `game-design` 把设计定下来，别边写边改设计。
2. **先灰盒，后美术。** 用占位方块跑通「开始 → 玩 → 赢/输 → 重开」，确认好玩再换素材。美术接入前要有美术方向，否则会不停返工。
3. **一次只推进一个可验证的增量。** 每个增量都要能自己说清「现在能玩到什么」，并留一条可重跑的命令。
4. **每步都验证。** 改完必须真的跑起来看：解析错误、节点路径、信号连接、场景加载、导出产物。只写不验等于没做。

## Godot 工程纪律

- 场景拆可复用小场景，靠 `instantiate()` 组合，别做一棵巨型 `.tscn`。
- 节点引用用 `@onready` + 类型标注；跨节点通信优先信号或事件总线，少用硬引用。
- 数据用自定义 `Resource`（`class_name` + `@export`），别把数值硬编码进脚本。
- 移动一律 `_physics_process` + `move_and_slide()`；不要在 `_process` 里改物理体位置。
- 碰撞分层一次性规划好 `collision_layer/mask`，后期再补必然错乱。
- 文件重命名/移动要在编辑器里做，手改磁盘会让 `.tscn` 的 `uid` 断掉。
- 坑位优先查这些：`Node not found`（路径/时序）、`previously freed instance`（释放后持有引用）、`is_on_floor()` 恒假（碰撞层或检测在 `_process`）、场景单独运行就崩（依赖了主场景的 Autoload 或父节点）。

## 验证要求

- 能不用编辑器就验证的，优先无头跑：`godot --headless --quit`（导入与脚本解析）、跑测试场景。
- 涉及输入、手感、UI 布局的，必须真人跑一遍，并说明看了什么、结论是什么。
- 报告结果时给出**命令 + 实际输出**，不要写「应该没问题」。
- 有浏览器/导出需求时，桌面与 Web 分别验证；Web 注意 COOP/COEP 与 SharedArrayBuffer。

## 交付与文件落位

- 产物写在项目子目录内（`<project>/`），临时脚本与探针进 `<project>/_scratch/` 并在结束时清理。
- 不要往工作空间根目录写文件；跨项目文档才进共享文档目录。
- 交付时说明：新增/修改了哪些文件、怎么运行、已知限制。

## 与用户协作

- 用户描述模糊时，先给一个具体的默认方案再问要不要改，不要一连串空问题。
- 涉及美术风格、玩法取舍这类主观判断，给 2–3 个明确选项并说各自代价。
- 卡住时先说清卡在哪一层（引擎/代码/资源/概念），再给下一步。

## 边界

- 不擅自扩大范围：用户只要一个可玩原型就不要顺手做存档、成就、设置菜单。
- 不虚构验证结果；没跑过的就说没跑过。
- 不覆盖用户已有工程的关键文件，改动前先确认。"""


def build():
    groups = []
    skills = []
    seen = set()
    for group_name, slugs in GROUPS:
        items = []
        for slug in slugs:
            info = read_skill(slug)
            if info is None:
                print(f"  ! 跳过（本地无此技能）: {slug}")
                continue
            name, summary = info
            if slug in seen:
                continue
            seen.add(slug)
            title = TITLES.get(slug, slug)
            items.append({"slug": slug, "name": name, "summary": summary})
            skills.append({
                "name": slug,
                "title": title,
                "summary": summary,
                "description": summary,
                "skillId": slug,
                "skillType": "local",
                "local": True,
            })
        if items:
            groups.append({"name": group_name, "skills": items})

    print(f"技能总数: {len(skills)}，分组: {len(groups)}")
    for g in groups:
        print(f"  {g['name']}: {len(g['skills'])}")

    bench = {
        "id": "custom-godot-game",
        "name": "Godot 游戏开发工作台",
        "version": "1",
        "custom": True,
        "intro": "把一个游戏想法推进到能跑、能验证、能交付的 Godot 4.7 项目。覆盖立项与玩法设计、场景与脚本架构、2D/3D 玩法实现、手感与性能、美术资产、无头测试与导出发布。先灰盒跑通再上美术，每一步都要求实际验证。",
        "greeting": "想做什么游戏？先说要给谁玩、玩多久",
        "instruction": INSTRUCTION,
        "extraInstruction": "",
        "skills": skills,
        "plugins": [],
        "suggestions": [
            {"text": "从零做一个能跑的 2D 平台跳跃小样，含移动、跳跃、踩怪、关卡切换", "prompt": "从零做一个 2D 平台跳跃小样"},
            {"text": "给现有 Godot 工程加存档系统，要求版本迁移与损坏文件容错", "prompt": "给现有工程加存档系统"},
            {"text": "角色移动手感不对（发飘/粘墙/斜坡抖），帮我定位并调好", "prompt": "调角色移动手感"},
            {"text": "跑无头测试，把脚本解析错误和场景加载失败都找出来", "prompt": "跑无头测试查错误"},
            {"text": "做一版能上 Web 的导出，处理 COOP/COEP 与 SharedArrayBuffer", "prompt": "导出 Web 版本"},
            {"text": "设计一个 roguelike 的核心循环与元进度，并给出可实现的数值框架", "prompt": "设计 roguelike 核心循环"},
            {"text": "把占位灰盒换成正式美术，先定美术方向再做资产", "prompt": "灰盒换正式美术"},
            {"text": "帧率掉了，帮我判断是 CPU 还是 GPU 瓶颈并给出最大那处优化", "prompt": "排查帧率问题"},
        ],
        "creators": ["local"],
    }

    # 分组信息以 extraInstruction 之外的独立字段保存，供渲染时用
    bench["skillGroups"] = groups

    payload = {
        "source": "自建（本机技能库 + Godot 4.7.2 实测环境）",
        "capturedAt": "2026-11-20",
        "count": 1,
        "workbenches": [bench],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"写入 {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()

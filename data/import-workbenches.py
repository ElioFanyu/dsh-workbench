#!/usr/bin/env python3
"""把抓到的平台工作台数据整理成插件能读的格式。

仓库不附带抓取到的提示词原文（属于各平台专有内容），所以这一步是**可选的**：
只想要自带的内容，直接跳过即可，插件会正常使用 data/custom-workbenches.json。

用法
----
你自己从目标平台取到原始响应后，把 workbench 对象存成一个 JSON 数组或
{"workbenches": [...]}，然后：

    python data/import-workbenches.py raw.json --out data/workbenches.json

脚本只做结构与字段归一化，不负责抓取（各平台的抓取方式不同，且会随版本变化）。
"""
import argparse
import json
import sys
from pathlib import Path


def first_sentence(text, limit=140):
    value = " ".join(str(text or "").split())
    if not value:
        return ""
    for mark in ("。", "！", "？"):
        if mark in value:
            value = value.split(mark, 1)[0] + mark
            break
    else:
        if ". " in value:
            value = value.split(". ", 1)[0] + "."
    return value if len(value) <= limit else value[: limit - 2] + "…"


def normalize_skill(raw):
    """把一份技能记录归一化成插件读取的字段。"""
    name = raw.get("name") or raw.get("slug") or raw.get("skill_id") or ""
    summary = raw.get("summary") or first_sentence(raw.get("description"))
    return {
        "name": str(name),
        "title": str(raw.get("title") or raw.get("name") or name),
        "summary": summary,
        "description": str(raw.get("description") or summary),
        "skillId": str(raw.get("skillId") or raw.get("skill_id") or ""),
        "skillType": str(raw.get("skillType") or raw.get("skill_type") or ""),
        "local": bool(raw.get("local", False)),
    }


def normalize_bench(raw):
    """把一份工作台记录归一化成插件读取的字段。"""
    skills = [normalize_skill(s) for s in (raw.get("skills") or [])]
    suggestions = []
    for item in raw.get("suggestions") or []:
        if isinstance(item, str):
            suggestions.append({"text": item, "prompt": item})
        elif isinstance(item, dict) and item.get("text"):
            suggestions.append({"text": str(item["text"]), "prompt": str(item.get("prompt") or item["text"])})

    return {
        "id": str(raw.get("id") or ""),
        "name": str(raw.get("name") or ""),
        "version": str(raw.get("version") or "1"),
        "custom": False,
        "intro": str(raw.get("intro") or ""),
        "greeting": str(raw.get("greeting") or ""),
        "instruction": str(raw.get("instruction") or ""),
        "extraInstruction": str(raw.get("extraInstruction") or raw.get("extra_instruction") or ""),
        "skills": skills,
        "plugins": raw.get("plugins") or [],
        "suggestions": suggestions,
        "creators": raw.get("creators") or [],
        "skillGroups": raw.get("skillGroups") or [],
    }


def main():
    ap = argparse.ArgumentParser(description="归一化平台工作台数据")
    ap.add_argument("source", help="原始 JSON 文件（数组，或含 workbenches 字段的对象）")
    ap.add_argument("--out", default="data/workbenches.json", help="输出路径")
    ap.add_argument("--source-label", default="", help="写进 source 字段的来源说明")
    args = ap.parse_args()

    text = Path(args.source).read_text(encoding="utf-8")
    parsed = json.loads(text)
    raw_list = parsed if isinstance(parsed, list) else parsed.get("workbenches", [])

    benches = []
    seen = set()
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        bench = normalize_bench(raw)
        if not bench["id"] or not bench["name"]:
            print(f"  跳过（缺 id 或 name）: {str(raw)[:60]}")
            continue
        if bench["id"] in seen:
            continue
        seen.add(bench["id"])
        if not bench["instruction"].strip():
            print(f"  跳过（没有提示词）: {bench['name']}")
            continue
        benches.append(bench)

    if not benches:
        print("没有可用工作台，未写入。", file=sys.stderr)
        return 1

    payload = {
        "source": args.source_label or "imported",
        "capturedAt": "",
        "count": len(benches),
        "workbenches": benches,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    total_skills = sum(len(b["skills"]) for b in benches)
    print(f"写入 {out}: {len(benches)} 个工作台，{total_skills} 条技能")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

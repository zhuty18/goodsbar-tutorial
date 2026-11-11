#!/usr/bin/env python3
"""把 /editor 导出的打包文件写回 src/content。

用法:
    python scripts/apply_bundle.py                       # 用 bundles/ 下最新的包，增量补充
    python scripts/apply_bundle.py --mode overwrite      # 同上，整份覆盖
    python scripts/apply_bundle.py --dry-run             # 只看计划，不落盘
    python scripts/apply_bundle.py 别的包.json            # 指定某个包
    python scripts/apply_bundle.py --out /tmp            # 写到别的目录

不传路径时，自动取 bundles/ 里修改时间最新的 .json（编辑器导出的文件名带时间戳）。

打包文件是 /editor 页面导出的 JSON，结构为:
    { "version": 1, "screens": [...], "ops": [...], ... }

两种模式:
  merge     （默认）按 id 合并：同 id 用包里的版本替换，包里没有的条目原样保留，
            包里的新条目追加到末尾；概念只写包里有的，不删除其它 .md。
            未改动的记录保留原文本，所以手写的注释、行内写法都不会被重排。
  overwrite 整份覆盖：以打包文件为准，包里没有的条目全部消失，
            概念目录下不在包里的 .md 会被直接删除（版本交给 git 管）。

两种模式都会先跑校验：id 唯一、引用不悬空、概念 related 有效。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "src" / "content"
DEFAULT_BUNDLE_DIR = ROOT / "bundles"

# Windows 控制台默认不是 UTF-8，强制一下，免得输出变乱码
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

# 每个 collection 写盘时的字段顺序
ORDER = {
    "screens": ["id", "name", "parent", "note"],
    "ops": ["id", "screen", "action", "short", "note", "keywords", "image", "hotspot"],
    "behaviors": ["id", "screen", "title", "intro", "tags", "ops"],
    "functions": ["id", "question", "summary", "category", "behaviors"],
    "tags": ["id", "label", "description"],
    "categories": ["id", "label", "description"],
}

# 需要对外校验的引用字段: collection -> [(field, target)]
REFS = {
    "ops": [("screen", "screens"), ("keywords", "concepts")],
    "behaviors": [("screen", "screens"), ("tags", "tags"), ("ops", "ops")],
    "functions": [("category", "categories"), ("behaviors", "behaviors")],
}

COMPOUND = {"hotspot"}

PLAIN = re.compile(r"^[A-Za-z0-9_./-]+$")
UNSAFE_START = set("-?:,[]{}#&*!|>'\"%@` ")
RESERVED = {"true", "false", "null", "yes", "no", "on", "off", "~"}
NUMBER = re.compile(r"^[-+]?\d+(\.\d+)?$")


def can_plain(text):
    """判断能否不加引号写成 YAML 标量。宁可多引号，也不要写出歧义。"""
    if not text or text != text.strip():
        return False
    if text[0] in UNSAFE_START:
        return False
    if any(char in text for char in "\n\r\t"):
        return False
    if ": " in text or text.endswith(":"):
        return False
    if " #" in text:
        return False
    if text.lower() in RESERVED or NUMBER.match(text):
        return False
    return True


def scalar(value):
    """把标量写成 YAML。能裸写就裸写，否则用 JSON 双引号（也是合法 YAML）。"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value)
    return text if can_plain(text) else json.dumps(text, ensure_ascii=False)


def inline_list(values):
    return all(can_plain(str(item)) and "," not in str(item) for item in values)


def is_empty(value):
    return value is None or value == [] or value == {} or value == ""


def dump_mapping(pairs, indent):
    pad = "  " * indent
    lines = []
    for key, value in pairs:
        if is_empty(value):
            continue
        if isinstance(value, dict):
            lines.append(f"{pad}{key}:")
            lines.extend(dump_mapping(value.items(), indent + 1))
        elif isinstance(value, list):
            if not value:
                lines.append(f"{pad}{key}: []")
            elif inline_list(value):
                lines.append(f"{pad}{key}: [{', '.join(str(item) for item in value)}]")
            else:
                lines.append(f"{pad}{key}:")
                for item in value:
                    lines.append(f"{pad}  - {scalar(item)}")
        else:
            lines.append(f"{pad}{key}: {scalar(value)}")
    return lines


def dump_records(records, order):
    lines = []
    for record in records:
        keys = [key for key in order if key in record]
        keys += [key for key in record if key not in order]

        first = True
        for key in keys:
            value = record[key]
            if is_empty(value):
                continue

            prefix = "- " if first else "  "
            first = False

            if isinstance(value, dict):
                lines.append(f"{prefix}{key}:")
                lines.extend(dump_mapping(value.items(), 2))
            elif isinstance(value, list):
                if not value:
                    lines.append(f"{prefix}{key}: []")
                elif inline_list(value):
                    lines.append(f"{prefix}{key}: [{', '.join(str(item) for item in value)}]")
                else:
                    lines.append(f"{prefix}{key}:")
                    for item in value:
                        lines.append(f"    - {scalar(item)}")
            else:
                lines.append(f"{prefix}{key}: {scalar(value)}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def validate(bundle):
    problems = []
    ids = {}

    for collection in ["screens", "ops", "behaviors", "functions", "tags", "categories", "concepts"]:
        records = bundle.get(collection) or []
        seen = set()
        for record in records:
            rid = record.get("id")
            if not rid:
                problems.append(f"{collection}: 有记录缺少 id")
                continue
            if rid in seen:
                problems.append(f"{collection}: id 重复 {rid}")
            seen.add(rid)
        ids[collection] = seen

    for collection, refs in REFS.items():
        for record in bundle.get(collection) or []:
            for field, target in refs:
                value = record.get(field)
                if value is None:
                    continue
                values = value if isinstance(value, list) else [value]
                for item in values:
                    if item not in ids[target]:
                        problems.append(f"{collection} {record.get('id')}: {field} 指向不存在的 {item}")

    for record in bundle.get("concepts") or []:
        for related in record.get("related") or []:
            if related not in ids["concepts"]:
                problems.append(f"concepts {record.get('id')}: related 指向不存在的 {related}")

    return problems


ID_PREFIX = "- id:"

# 形如 `# ---------- 商品列表 ----------` 的分组注释：记录按 id 重排之后它们就没意义了
SECTION_MARKER = re.compile(r"^#\s*-{3,}.*$")

try:  # 装了 PyYAML 就顺便校验产出；没装也能跑
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


def split_records(text):
    """把 YAML 按 `- id:` 切成文件头 + 若干块；不解析 YAML，只认块边界，注释原样保留。"""
    header = []
    blocks = []
    current = None

    for line in text.splitlines(keepends=True):
        if line.startswith(ID_PREFIX):
            if current is not None:
                blocks.append(current)
            current = [line.split(":", 1)[1].strip().strip('"'), [line]]
        elif current is not None:
            current[1].append(line)
        else:
            header.append(line)

    if current is not None:
        blocks.append(current)

    # 文件头只保留字段说明，分组注释截掉（记录要按 id 重排，分组就不成立了）
    header_text = "".join(header).splitlines(keepends=True)
    for index, line in enumerate(header_text):
        if SECTION_MARKER.match(line):
            header_text = header_text[:index]
            break

    return "".join(header_text), blocks


def strip_section_markers(text):
    return "".join(line for line in text.splitlines(keepends=True) if not SECTION_MARKER.match(line))


def join_blocks(header, entries):
    """文件头 + 按 id 排好序的记录块。"""
    body = "\n\n".join(text.rstrip("\n") for _, text in entries if text.strip())
    if header.strip():
        return header.rstrip("\n") + "\n\n" + body + "\n"
    return body + "\n"


def verify_yaml(collection, text, expected_ids):
    """装了 PyYAML 的话，把刚生成的文本反解回来，确认 id 顺序和内容条数都对得上。"""
    if yaml is None:
        return

    try:
        data = yaml.safe_load(text)
    except Exception as error:  # noqa: BLE001
        raise SystemExit(f"{collection}.yaml 生成后无法被 PyYAML 解析：{error}") from error

    parsed_ids = [item.get("id") for item in (data or [])]
    if parsed_ids != expected_ids:
        raise SystemExit(f"{collection}.yaml 解析出的 id 与预期不一致：{parsed_ids} != {expected_ids}")


def dump_record(record, order):
    return dump_records([record], order).rstrip("\n")


def merge_collection_text(collection, records, existing_text):
    """按 id 合并：同 id 用包里的版本替换，包里没有的原样保留，最后统一按 id 排序。"""
    header, blocks = split_records(existing_text)
    existing_ids = {rid for rid, _ in blocks}
    by_id = {record["id"]: record for record in records}

    entries = []
    added = updated = kept = 0

    for rid, lines in blocks:
        record = by_id.get(rid)
        if record is None:
            entries.append((rid, strip_section_markers("".join(lines))))
            kept += 1
        else:
            entries.append((rid, dump_record(record, ORDER[collection])))
            updated += 1

    for record in records:
        if record["id"] not in existing_ids:
            entries.append((record["id"], dump_record(record, ORDER[collection])))
            added += 1

    entries.sort(key=lambda item: item[0])

    text = join_blocks(header, entries)
    return text, added, updated, kept, [rid for rid, _ in entries]


def collection_text(collection, records, existing_text=""):
    """整份重写：文件头沿用旧的，记录按 id 排序。"""
    header = split_records(existing_text)[0] if existing_text else ""
    entries = [(record["id"], dump_record(record, ORDER[collection])) for record in records]
    entries.sort(key=lambda item: item[0])
    return join_blocks(header, entries)


def normalize_newlines(text):
    """统一成 \\n 再交给 write_text，避免正文里带的 \\r\\n 被翻译成 \\r\\r\\n。"""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def write_text_file(path, text):
    """写盘固定用 CRLF：内容先在内存里统一成 \\n，再由 newline 参数翻译。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(normalize_newlines(text), encoding="utf-8", newline="\r\n")
    return path


def write_collection(out_dir, collection, text):
    path = out_dir / collection / f"{collection}.yaml"
    return write_text_file(path, text)


def concept_markdown(concept):
    return "\n".join(
        [
            "---",
            f"title: {scalar(concept.get('title', ''))}",
            f"summary: {scalar(concept.get('summary', ''))}",
            f"aliases: [{', '.join(concept.get('aliases') or [])}]",
            f"related: [{', '.join(concept.get('related') or [])}]",
            "---",
            "",
            (concept.get("body") or "").strip(),
            "",
        ]
    )


def write_concepts(out_dir, concepts, delete_missing):
    directory = out_dir / "concepts"
    directory.mkdir(parents=True, exist_ok=True)

    written = []
    for concept in concepts:
        path = directory / f"{concept['id']}.md"
        write_text_file(path, concept_markdown(concept))
        written.append(path)

    removed = []
    if delete_missing:
        keep = {path.name for path in written}
        for path in directory.glob("*.md"):
            if path.name not in keep:
                removed.append(path)
                path.unlink()

    return written, removed


def latest_bundle(directory: Path = DEFAULT_BUNDLE_DIR) -> Path:
    """bundles/ 下最新的 .json（按修改时间）。"""
    if not directory.is_dir():
        sys.exit(f"没给打包文件，也找不到目录：{directory}")

    files = [path for path in directory.glob("*.json") if path.is_file()]
    if not files:
        sys.exit(f"没给打包文件，{directory} 里也没有 .json")

    return max(files, key=lambda path: path.stat().st_mtime)


def main():
    parser = argparse.ArgumentParser(description="把编辑器导出的内容包写回 src/content")
    parser.add_argument(
        "bundle",
        type=Path,
        nargs="?",
        help="打包文件路径（/editor 导出的 JSON）；不传就用 bundles/ 下最新的那个",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="输出目录，默认 src/content")
    parser.add_argument(
        "--mode",
        choices=["merge", "overwrite"],
        default="merge",
        help="merge=增量补充（默认）：同 id 覆盖、包里没有的保留；overwrite=整份覆盖：包里没有的全部删除",
    )
    parser.add_argument("--dry-run", action="store_true", help="只校验并打印计划，不写文件")
    args = parser.parse_args()

    if args.bundle is None:
        args.bundle = latest_bundle()
        print(f"没给打包文件，用最新的：{args.bundle.relative_to(ROOT)}")

    if not args.bundle.exists():
        sys.exit(f"找不到打包文件: {args.bundle}")

    bundle = json.loads(args.bundle.read_text(encoding="utf-8"))

    # 概念现在是推导出来的：旧打包文件里可能还带着 functions[].concepts，写盘前丢掉
    for record in bundle.get("functions") or []:
        record.pop("concepts", None)

    # 界面路径也是推导出来的，别写回 YAML
    for record in bundle.get("screens") or []:
        record.pop("route", None)

    problems = validate(bundle)
    if problems:
        print(f"校验失败，共 {len(problems)} 项：", file=sys.stderr)
        for index, problem in enumerate(problems, 1):
            print(f"  {index}. {problem}", file=sys.stderr)
        sys.exit(1)

    out_dir = args.out
    concepts = bundle.get("concepts") or []
    overwrite = args.mode == "overwrite"

    summary = {"added": 0, "updated": 0, "kept": 0, "written": 0}
    removed = []

    for collection in ORDER:
        records = bundle.get(collection) or []
        path = out_dir / collection / f"{collection}.yaml"
        existing = path.read_text(encoding="utf-8") if path.exists() else ""

        # 覆盖模式、或者文件还不存在，就直接整份重写（按 id 排序，沿用旧文件头）
        if overwrite or not existing:
            summary["written"] += len(records)
            if not overwrite:
                summary["added"] += len(records)
            text = collection_text(collection, records, existing)
            if not args.dry_run:
                verify_yaml(collection, text, sorted(record["id"] for record in records))
                write_collection(out_dir, collection, text)
            continue

        text, added, updated, kept, ids = merge_collection_text(collection, records, existing)
        summary["added"] += added
        summary["updated"] += updated
        summary["kept"] += kept
        if not args.dry_run:
            verify_yaml(collection, text, ids)
            write_text_file(path, text)

    if args.dry_run:
        if overwrite:
            directory = out_dir / "concepts"
            keep = {f"{concept['id']}.md" for concept in concepts}
            if directory.exists():
                removed = [p for p in sorted(directory.glob("*.md")) if p.name not in keep]
    else:
        out_dir.mkdir(parents=True, exist_ok=True)
        _, removed = write_concepts(out_dir, concepts, delete_missing=overwrite)

    # ---------------------------------------------------------------- 汇报

    label = "整份覆盖（overwrite）" if overwrite else "增量补充（merge）"
    suffix = "（dry-run，未写文件）" if args.dry_run else ""
    print(f"模式：{label}{suffix}")

    if overwrite:
        print(f"  写入 {summary['written']} 条，概念 {len(concepts)} 个")
    else:
        print(
            f"  新增 {summary['added']} 条 / 更新 {summary['updated']} 条 / 保留 {summary['kept']} 条，"
            f"概念写入 {len(concepts)} 个"
        )

    if removed:
        print(f"{'将删除' if args.dry_run else '删除'}概念文件 {len(removed)} 个：")
        for path in removed:
            print(f"  - {path.name}")
    elif overwrite:
        print("  没有需要删除的概念文件")

    print("\n下一步: pnpm build")


if __name__ == "__main__":
    main()

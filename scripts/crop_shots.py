#!/usr/bin/env python3
"""把 shots-original 里的原始截图处理成 public/shots 里能直接上线的 WebP。

流程（两步）:
  1. 生成：shots-original 下每个 .jpg → 裁掉上侧 80px 系统状态栏 → 缩放到 50%
     （3008x1880 → 3008x1800 → 1504x900）→ 按 q85 存成同目录同名的 .webp
  2. 同步：先清空 public/shots 下已有的 .webp，再把 shots-original 里的 .webp
     按原目录结构复制进 public/shots

用法:
    python scripts/crop_shots.py               # 生成 + 同步
    python scripts/crop_shots.py --dry-run     # 只报告，不动文件
    python scripts/crop_shots.py --no-sync     # 只生成 shots-original 里的 webp
    python scripts/crop_shots.py --only-sync   # 只把 webp 同步过去
    python scripts/crop_shots.py --quality 90  # 换 WebP 质量（默认 85）

源图（shots-original 里的 jpg）始终保留，webp 是可随时重跑的中间产物。
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "shots-original"
DEFAULT_DEST = ROOT / "public" / "shots"

# 原始截图是 3008x1880，裁掉 80px 状态栏后是 3008x1800，再缩一半就是 1504x900
SOURCE_SIZE = (3008, 1880)
STRIP_HEIGHT = 80
SCALE = 0.5
WEBP_QUALITY = 85
WEBP_METHOD = 6  # 最慢但压得最小，离线批处理不差这点时间

# Windows 控制台默认不是 UTF-8，强制一下，免得输出变乱码
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")


def rel(path: Path) -> str:
    """尽量用相对仓库根目录的写法，方便阅读。"""
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def is_hidden(path: Path, base: Path) -> bool:
    """. 开头的目录（比如 public/shots/.sync_temp_dir）不参与处理。"""
    return any(part.startswith(".") for part in path.relative_to(base).parts)


def iter_files(base: Path, exts: set[str]):
    for path in sorted(base.rglob("*")):
        if path.is_file() and path.suffix.lower() in exts and not is_hidden(path, base):
            yield path


def scaled_size(size: tuple[int, int], strip: int, scale: float) -> tuple[int, int]:
    """裁掉上侧 strip 像素后再按 scale 缩放后的尺寸。"""
    return round(size[0] * scale), round((size[1] - strip) * scale)


def generate_one(path: Path, args) -> tuple[str, tuple[int, int], Path, str]:
    """把一张 jpg 处理成同目录的 webp。返回 (状态, 原始尺寸, 输出文件, 备注)。"""
    target = path.with_suffix(".webp")
    try:
        with Image.open(path) as image:
            size = image.size
            if size != SOURCE_SIZE:
                return "skip", size, target, "不是 3008x1880，没敢裁"

            if args.dry_run:
                return "plan", size, target, ""

            work = image.crop((0, args.strip, size[0], size[1]))
            if work.mode not in {"RGB", "RGBA"}:
                work = work.convert("RGBA" if "A" in work.getbands() else "RGB")
            resized = work.resize(scaled_size(size, args.strip, args.scale), Image.LANCZOS)
            # resize 之后像素已经全在内存里了，关掉源文件句柄再写盘
    except (OSError, ValueError) as error:
        return "error", (0, 0), target, str(error)

    # 先写临时文件再替换，半路失败也不会留下残缺的图
    tmp = target.with_name(target.name + ".tmp-webp")
    try:
        resized.save(tmp, format="WEBP", quality=args.quality, method=WEBP_METHOD)
        os.replace(tmp, target)
    except (OSError, ValueError) as error:
        return "error", size, target, str(error)
    finally:
        if tmp.exists():
            tmp.unlink()

    return "ok", size, target, ""


def dest_webp_files(dest: Path):
    for path in sorted(dest.rglob("*.webp")):
        if path.is_file() and not is_hidden(path, dest):
            yield path


def prune_empty_dirs(dest: Path) -> None:
    """清掉 webp 之后可能留下的空目录（同步时再按源目录结构建回来）。"""
    dirs = [p for p in dest.rglob("*") if p.is_dir() and not is_hidden(p, dest)]
    for path in sorted(dirs, key=lambda p: len(p.parts), reverse=True):
        try:
            path.rmdir()
        except OSError:
            pass


def report_problems(skipped: list, failed: list) -> None:
    if skipped:
        print(f"\n跳过 {len(skipped)} 个：")
        for path, size, note in skipped:
            print(f"  {rel(path)}  {size[0]}x{size[1]}  {note}")
    if failed:
        print(f"\n失败 {len(failed)} 个：", file=sys.stderr)
        for path, reason in failed:
            print(f"  {rel(path)}  {reason}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="shots-original 裁状态栏、缩一半转 WebP，再同步到 public/shots")
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC, help="原始截图目录（默认 shots-original）")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="上线截图目录（默认 public/shots）")
    parser.add_argument("--strip", type=int, default=STRIP_HEIGHT, help="从顶部裁掉的高度，默认 80")
    parser.add_argument("--scale", type=float, default=SCALE, help="裁剪后的缩放比例，默认 0.5")
    parser.add_argument("--quality", type=int, default=WEBP_QUALITY, help="WebP 质量 0-100，默认 85")
    parser.add_argument("--no-sync", action="store_true", help="只生成 shots-original 里的 webp，不同步")
    parser.add_argument("--only-sync", action="store_true", help="只做同步，不重新生成 webp")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    args = parser.parse_args()

    if args.strip <= 0:
        parser.error("--strip 必须是正数")
    if not 0 < args.scale <= 1:
        parser.error("--scale 必须在 (0, 1] 之间")
    if not 0 <= args.quality <= 100:
        parser.error("--quality 必须在 0-100 之间")
    if not args.src.is_dir():
        print(f"源目录不存在: {args.src}", file=sys.stderr)
        sys.exit(1)

    ok: list[tuple[Path, Path, tuple[int, int]]] = []
    planned: list[tuple[Path, Path, tuple[int, int]]] = []
    skipped: list[tuple[Path, tuple[int, int], str]] = []
    failed: list[tuple[Path, str]] = []
    bytes_before = bytes_after = 0

    # ---------------------------------------------------------------- 1. 生成

    if not args.only_sync:
        print(f"步骤 1/2 生成 webp：{rel(args.src)} 里的 jpg")
        for path in iter_files(args.src, {".jpg", ".jpeg"}):
            try:
                size_before = path.stat().st_size
            except OSError:
                size_before = 0
            status, size, target, note = generate_one(path, args)
            if status == "ok":
                ok.append((path, target, size))
                bytes_before += size_before
                bytes_after += target.stat().st_size if target.exists() else 0
            elif status == "plan":
                planned.append((path, target, size))
            elif status == "skip":
                skipped.append((path, size, note))
            else:
                failed.append((path, note))

        shown = planned if args.dry_run else ok
        out_w, out_h = scaled_size(SOURCE_SIZE, args.strip, args.scale)
        if shown:
            verb = "将生成" if args.dry_run else "已生成"
            print(
                f"  {verb} {len(shown)} 个：{SOURCE_SIZE[0]}x{SOURCE_SIZE[1]}"
                f" -> 裁 {args.strip}px -> {out_w}x{out_h}，q{args.quality}"
            )
            for path, target, _ in shown:
                print(f"    {rel(path)} -> {target.name}")
            if not args.dry_run and bytes_before:
                print(
                    f"  体积：{bytes_before / 1048576:.1f}MB(jpg) -> {bytes_after / 1048576:.1f}MB(webp)"
                    f"，省 {(1 - bytes_after / bytes_before) * 100:.0f}%"
                )
        elif not skipped and not failed:
            print("  没有找到需要处理的 jpg")

    # 生成阶段有问题就停在同步之前：先清空再复制，半路出错会让站点缺图
    if skipped or failed:
        report_problems(skipped, failed)
        if not args.only_sync:
            print(
                f"\n生成阶段有 {len(skipped)} 个尺寸不符 / {len(failed)} 个失败，"
                f"已停在同步之前，{rel(args.dest)} 没动",
                file=sys.stderr,
            )
        sys.exit(1)

    # ---------------------------------------------------------------- 2. 同步

    existing = list(iter_files(args.src, {".webp"}))
    # 源目录里没有对应 jpg 的 webp 是上一轮留下的孤儿，会原样复制过去，提醒一下
    jpg_stems = {path.with_suffix("") for path in iter_files(args.src, {".jpg", ".jpeg"})}
    orphans = [path for path in existing if path.with_suffix("") not in jpg_stems]
    if orphans:
        print(f"\n注意：{len(orphans)} 个 webp 在源目录里没有对应 jpg，会原样同步：", file=sys.stderr)
        for path in orphans:
            print(f"  {rel(path)}", file=sys.stderr)

    if args.dry_run:
        # dry-run 时新 webp 还没落盘，把计划生成的那几个也算进待复制清单
        seen = {path.resolve() for path in existing}
        source_webp = existing + [target for _, target, _ in planned if target.resolve() not in seen]
    else:
        source_webp = existing
    copied = 0

    if not args.no_sync:
        if not args.dry_run:
            args.dest.mkdir(parents=True, exist_ok=True)
        stale = list(dest_webp_files(args.dest)) if args.dest.is_dir() else []
        print(f"\n步骤 2/2 同步：{rel(args.src)} 的 webp -> {rel(args.dest)}")
        print(f"  {'将清空' if args.dry_run else '已清空'} {len(stale)} 个旧 webp")
        if not args.dry_run:
            for path in stale:
                path.unlink()
            prune_empty_dirs(args.dest)

        for path in source_webp:
            target = args.dest / path.relative_to(args.src)
            copied += 1
            if args.dry_run:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        print(f"  {'将复制' if args.dry_run else '已复制'} {copied} 个 webp")

        if source_webp:
            total = sum(path.stat().st_size for path in source_webp if path.exists())
            if total:
                print(f"  合计 {total / 1048576:.1f}MB")

    # ---------------------------------------------------------------- 汇报

    if args.dry_run:
        print("\ndry-run：没有写任何文件")
    elif not args.no_sync:
        print(f"\n下一步: pnpm build（{rel(args.dest)} 已更新）")


if __name__ == "__main__":
    main()

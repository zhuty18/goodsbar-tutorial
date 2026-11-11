# GoodsBar 使用手册

一份按「你想做什么」组织的手册：选一个需求，页面会告诉你要经过哪些界面、点哪几个按钮、遇到某个词是什么意思。

## 关于 GoodsBar

GoodsBar是一款一站式出摊辅助工具，软件网站主页即将上线。

反馈交流群：1070149316

## 如果你希望帮忙

手册是靠使用现场的反馈慢慢变准的。发现某一步和软件对不上、某个说法有歧义、或者某个词解释得不对劲，都可以直接改：

**[手册数据维护 →](docs/maintaining-content.md)**

不需要会写代码，也不用碰 Git——有个浏览器就够了。

## 这是什么

- 每一页对应一个使用需求，一个问题一页，URL 可以直接发给同事。
- 页面不是手写的，而是用「行为 → 原子操作」的数据在构建时拼出来的。
- 概念（比如「库存扣减」）会在第一次用到它的那一步下方展开解释，不堆在页首当标签。
- 纯静态：首屏就是 HTML，能被搜索、被分享、被打印，没有前端框架在跑。

## 怎么构建

需要 Node 22.12+ 和 pnpm；处理截图另需 Python 3 + Pillow。

```bash
pnpm install
pnpm dev       # http://localhost:4321/goodsbar-tutorial/
pnpm build     # 产物在 dist/，纯静态
pnpm preview
```

站点挂在子路径 `/goodsbar-tutorial/` 下。部署时把 `dist/` 的内容放到这个路径即可（GitHub Pages、Nginx、任意静态托管都行）。

> 本项目在 `.npmrc` 里设了 `node-linker=hoisted`，原因是某些环境下 pnpm 的符号链接布局会解析失败；普通环境去掉也能装。

## 内容是怎么长出来的

内容分三层，外加一本概念词典：

```
功能（一个使用需求）
  └─ 行为（一个界面里的一组操作，有先后顺序）
       └─ 原子操作（一次点击或输入）
```

写内容的人不需要手写这些文件——站点自带 `/editor` 页面，在那里维护、导出数据包，再由维护者合并回仓库。具体流程见 [手册数据维护](docs/maintaining-content.md)。

内容的引用关系（某个行为用到了哪些操作、某个功能包含哪些行为）在构建时校验，写错了会直接构建失败，不会产出一个缺步骤的页面。构建失败的提示会指出是哪一条、缺了什么。

概念之间的「相关概念」是**相互的**：内容里只写一边就行，构建时会自动补上反向链接（编辑器里勾选也会同步反向）。

## 技术栈

**Astro**（在构建期生成静态页面）+ **Tailwind CSS 4** + **daisyUI 5**。

选 Astro 而不是单页应用的原因很简单：这份手册是只读内容、页面数量可预知，用户点一个需求是**换一页**而不是换一段状态。构建期生成意味着每个需求一个真实 URL、不需要等 JS、老设备也能看。

## 目录

```
src/content/      内容数据（界面、原子操作、行为、功能、概念、标签、分类）
src/lib/          读取与校验、页面组装、概念关联图布局
src/pages/        页面：首页、功能页、概念页、界面一览、内容体检、编辑器
scripts/          维护脚本：数据包合并、截图处理、换行符归一
shots-original/   截图源图（3008×1880 的 jpg，命名见下；已忽略，不进仓库也不上线）
public/shots/     上线截图（1504×900 的 WebP；可以脚本生成，也可以直接放）
docs/             维护者文档
```

## 给维护者

### 改内容

编辑器导出的数据包用脚本合并。导出文件名带时间戳，放进 `bundles/` 后直接跑脚本即可（自动取最新的那个）：

```bash
python scripts/apply_bundle.py                  # 用 bundles/ 下最新的包，增量合并
python scripts/apply_bundle.py --mode overwrite # 整份覆盖
python scripts/apply_bundle.py --dry-run        # 只看计划，不落盘
python scripts/apply_bundle.py 某个包.json       # 指定文件
```

合并后所有 YAML 会按 id 重排，然后 `pnpm build`。

### 处理截图

**先说结论：这套流程不是必须的，只是一套打包好的批处理。** 手册真正需要的只有一件事——`public/shots/` 里有体积小的 WebP（1504×900 左右就够）。你自己把图转成 webp、按下面的命名放进去，一样能用；这个目录不会被脚本清空（脚本默认只覆盖同名文件，`--prune` 才会删掉源目录里没有的图）。

想批量处理**手机原始截图**（3008×1880、顶部带状态栏）时，才需要这套工作流，两处目录分工如下：

- **`shots-original/`（源图）**：原始截图，按最终文件名和目录结构放好。整目录在 `.gitignore` 里，不进仓库，也不参与部署。
- **`public/shots/`（上线资源）**：统一是 1504×900 的 WebP，最终会被部署出去。

改完源图，跑一次脚本把整条链子走完：

```bash
python scripts/crop_shots.py                 # 生成 + 同步，日常就用这条
python scripts/crop_shots.py --dry-run       # 只看会动哪些文件
python scripts/crop_shots.py --no-sync       # 只生成 shots-original 里的 webp
python scripts/crop_shots.py --only-sync     # 只把已有 webp 同步到 public/shots
python scripts/crop_shots.py --prune         # 同步时删掉 public/shots 里源目录没有的 webp
python scripts/crop_shots.py --quality 90    # 换压缩质量（默认 85）
```

脚本做两步（需要 Python 3 + Pillow）：

1. **生成**：`shots-original/**/*.jpg` → 裁掉上侧 80px 的状态栏（时间 / 网络 / 电量）→ 缩放到 50%（3008×1880 → 3008×1800 → 1504×900）→ 按 q85 存成**同目录同名**的 `.webp`
2. **同步**：把 `shots-original` 的 webp 按原目录结构复制进 `public/shots`。默认只覆盖同名文件，目录里其它的图（包括你手动放进去的）原样保留；加 `--prune` 才让 `public/shots` 严格等于源目录。

重跑是幂等的，源图的 jpg 一直留着，换参数随时可以重来。一个保护：源图尺寸不是 3008×1880 时会跳过该图并**停在同步之前**（不会动 `public/shots`），退出码 1；源目录里没有对应 jpg 的 webp 会单独告警，通常是改名后留下的旧文件。

**命名规则**——`shots-original/` 里的路径决定这张图挂在哪个界面（同步后 `public/shots` 结构相同）：

| 路径 | 作用 |
| --- | --- |
| `dashboard.jpg` | 一级界面的默认截图（不带编号的优先） |
| `dashboard-1.jpg` | 同一界面的第 1、2… 张，按编号排序 |
| `product-management/new-product.jpg` | 只给那一个原子操作用，优先于界面级截图 |
| `product-management/new-single.jpg` | 二级界面 `new-single` 的截图，放在父界面目录下 |

同一张图有多种格式时，站点按 **webp → jpg → png** 的顺序取第一张。加完图记得重新 `pnpm build`——页面用的是构建时读到的文件清单；`pnpm dev` 下刷新页面即可。编辑器里新建界面时，截图预览就是按上面这套命名实时匹配的，不用先存一次再看。

---

站点与工具链由 DeepSeek Harness (DeepSeek-V4.1-Flash-1017) 进行搭建。

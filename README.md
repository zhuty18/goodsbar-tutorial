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

需要 Node 22.12+ 和 pnpm。

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

## 技术栈

**Astro**（在构建期生成静态页面）+ **Tailwind CSS 4** + **daisyUI 5**。

选 Astro 而不是单页应用的原因很简单：这份手册是只读内容、页面数量可预知，用户点一个需求是**换一页**而不是换一段状态。构建期生成意味着每个需求一个真实 URL、不需要等 JS、老设备也能看。

## 目录

```
src/content/   内容数据（界面、原子操作、行为、功能、概念、标签、分类）
src/lib/       读取与校验、页面组装、概念关联图布局
src/pages/     页面：首页、功能页、概念页、界面一览、内容体检、编辑器
scripts/       维护脚本：数据包合并、截图处理、换行符归一
public/shots/  界面截图（上线资源，1504×900 的 WebP）
docs/          维护者文档
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

手册只认 `public/shots/` 下的图，统一是 **1504×900 的 WebP**。手机原始截图（3008×1880，顶部带状态栏）直接丢进去，用脚本批量处理：

```bash
python scripts/crop_shots.py                 # 裁状态栏 + 缩放 + 转 WebP，源图替换掉
python scripts/crop_shots.py --dry-run       # 先看会动哪些文件
python scripts/crop_shots.py --keep-source   # 保留源图，只多出一份 webp
python scripts/crop_shots.py --quality 90    # 换压缩质量（默认 85）
```

它做三件事：裁掉顶部 80px 的状态栏（时间/网络/电量）→ 缩到 1504×900 → 存成同名 `.webp`。原始尺寸的图备份在 `.shots-original/`（已忽略，不进仓库也不上线）；已经是 1504×900 的 webp 会跳过，所以重复执行安全。

文件放在哪儿，决定它挂在哪个界面：

| 路径 | 作用 |
| --- | --- |
| `shots/<界面id>.webp` | 一级界面的默认截图（不带编号优先） |
| `shots/<界面id>-1.webp` | 同一界面的第 1、2…张 |
| `shots/<界面id>/<操作id>.webp` | 只给那一个原子操作用，优先于界面级 |
| `shots/<父界面id>/<界面id>.webp` | 二级界面的截图，放在父界面目录下 |

同名多种格式并存时按 **webp → jpg → png** 取舍。

---

站点与工具链由 DeepSeek Harness (DeepSeek-V4.1-Flash-1017) 进行搭建。

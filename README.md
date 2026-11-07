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
scripts/       维护脚本：把编辑器导出的数据包合并回内容目录
docs/          维护者文档
```

## 给维护者

编辑器导出的数据包用脚本合并：

```bash
python scripts/apply_bundle.py goodsbar-content.json                  # 增量合并（默认）
python scripts/apply_bundle.py goodsbar-content.json --mode overwrite # 整份覆盖
python scripts/apply_bundle.py goodsbar-content.json --dry-run        # 只看计划
```

合并后所有 YAML 会按 id 重排，然后 `pnpm build`。

---

站点与工具链由 DeepSeek Harness (DeepSeek-V4.1-Flash-1017) 进行搭建。

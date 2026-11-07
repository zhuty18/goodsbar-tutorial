import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { marked } from 'marked';
import { z } from 'zod';

import { BASE, withBase } from './url';

/**
 * 内容层：把 src/content 下的结构化内容读成一个图，并在构建期校验。
 *
 * 四张表 + 一个词典：
 *   界面 screens    —— 原子操作的容器
 *   原子操作 ops     —— 用户的一次原始动作，绑定唯一界面
 *   行为 behaviors   —— 单个界面内、有顺序的原子操作序列
 *   功能 functions   —— 有顺序的行为序列，对应一个「使用需求」
 *   概念 concepts    —— 独立解释的术语，由原子操作的关键字引用
 *
 * 任何一条引用悬空、任何一个概念没被关键字覆盖，构建都会失败。
 */

/* ------------------------------------------------------------------ 模型 */

const screenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 亲界面：留空是一级界面，否则指向一个一级界面（最多两级） */
  parent: z.string().min(1).optional(),
  note: z.string().optional(),
});

const hotspotSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const opSchema = z.object({
  id: z.string().min(1),
  screen: z.string().min(1),
  action: z.string().min(1),
  /** 界面示意图下方显示的中文简称，四五个字，用来一眼认出这一步在干嘛 */
  short: z.string().min(1),
  note: z.string().optional(),
  /** 这一步的界面截图，路径相对 public/，例如 shots/product-list/click-new.png */
  image: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).default([]),
  hotspot: hotspotSchema.optional(),
});

const behaviorSchema = z.object({
  id: z.string().min(1),
  screen: z.string().min(1),
  title: z.string().min(1),
  intro: z.string().optional(),
  /** 自定义位标签，挂在「行为」（行为）上，值取自标签词典 */
  tags: z.array(z.string().min(1)).default([]),
  ops: z.array(z.string().min(1)).min(1),
});

const functionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  summary: z.string().min(1),
  /** 功能分类，指向 categories 词典 */
  category: z.string().min(1),
  behaviors: z.array(z.string().min(1)).min(1),
});

const conceptSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
});

const tagSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const categorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export type ScreenRecord = z.infer<typeof screenSchema>;

/** 界面：parent 表达层级，route 由层级推导出来，不落盘 */
export interface Screen extends ScreenRecord {
  route: string;
}

export type Hotspot = z.infer<typeof hotspotSchema>;
export type Op = z.infer<typeof opSchema>;
export type Behavior = z.infer<typeof behaviorSchema>;
export type Func = z.infer<typeof functionSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Category = z.infer<typeof categorySchema>;

export interface Concept {
  id: string;
  title: string;
  summary: string;
  aliases: string[];
  related: string[];
  /** 原始 Markdown 正文（不含 frontmatter），编辑器要拿它回写 */
  body: string;
  html: string;
}

export interface Coverage {
  fnId: string;
  declared: string[];
  provided: string[];
  gaps: string[];
}

export type WarningKind = 'image' | 'hotspot' | 'tag' | 'category' | 'concept';

export interface GraphWarning {
  kind: WarningKind;
  /** 关键信息：条目名称 */
  title: string;
  /** 英文 id */
  id: string;
  /** 改哪里：文件路径或「文件 · id」 */
  location: string;
}

export interface Graph {
  screens: Map<string, Screen>;
  ops: Map<string, Op>;
  behaviors: Map<string, Behavior>;
  functions: Func[];
  concepts: Map<string, Concept>;
  /** 标签词典：id → 词条，页面显示用 label */
  tags: Map<string, Tag>;
  /** 功能分类词典：id → 中文名，卡片角标取 label 首字 */
  categories: Map<string, Category>;
  /** 每个界面可用的截图（相对 public/），按编号排好；第一个是默认图 */
  shots: Map<string, string[]>;
  coverage: Coverage[];
  warnings: GraphWarning[];
  stats: {
    screens: number;
    behaviors: number;
    ops: number;
    functions: number;
    concepts: number;
    steps: number;
  };
}

/* ---------------------------------------------------------------- 读取 */

/**
 * 截图按 `public/shots/<界面id>-<编号>.png` 放。
 * 同一个界面可以有多张，编号小的排在前面，第一个就是该界面的默认截图。
 */
const SHOT_PATTERN = /^(.+)-(\d+)\.(png|jpe?g|webp)$/i;

function loadShots(): Map<string, string[]> {
  const dir = path.resolve(process.cwd(), 'public', 'shots');
  const grouped = new Map<string, { index: number; file: string }[]>();

  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return new Map();
  }

  for (const file of files) {
    const match = file.match(SHOT_PATTERN);
    if (!match) continue;
    const list = grouped.get(match[1]) ?? [];
    list.push({ index: Number(match[2]), file });
    grouped.set(match[1], list);
  }

  const shots = new Map<string, string[]>();
  for (const [screenId, list] of grouped) {
    shots.set(
      screenId,
      list.sort((a, b) => a.index - b.index).map((item) => `shots/${item.file}`),
    );
  }
  return shots;
}

const rawScreens = import.meta.glob('../content/screens/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawOps = import.meta.glob('../content/ops/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawBehaviors = import.meta.glob('../content/behaviors/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawFunctions = import.meta.glob('../content/functions/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawConcepts = import.meta.glob('../content/concepts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawTags = import.meta.glob('../content/tags/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawCategories = import.meta.glob('../content/categories/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * 一个 YAML 文件可以是一条记录，也可以是一组记录。
 * 条目少的时候写在一张表里更清楚，多了再拆成一实体一文件——两种写法都支持。
 */
function loadRows<T>(files: Record<string, string>, schema: z.ZodType<T, any, any>, label: string): T[] {
  return Object.entries(files).flatMap(([path, raw]) => {
    const doc = parseYaml(raw);
    const rows: unknown[] = Array.isArray(doc) ? doc : [doc];

    return rows.map((row, index) => {
      const result = schema.safeParse(row);
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => `   · ${issue.path.join('.') || '(根节点)'} ${issue.message}`)
          .join('\n');
        const where = rows.length > 1 ? `${path} 第 ${index + 1} 条` : path;
        throw new Error(`${label}格式错误 → ${where}\n${detail}`);
      }
      return result.data;
    });
  });
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function loadConcepts(files: Record<string, string>): Concept[] {
  return Object.entries(files).map(([path, raw]) => {
    const id = path.split('/').pop()!.replace(/\.md$/, '');
    const matched = raw.match(FRONTMATTER);
    if (!matched) throw new Error(`概念缺少 frontmatter → ${path}`);

    const result = conceptSchema.safeParse(parseYaml(matched[1]));
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `   · ${issue.path.join('.') || '(根节点)'} ${issue.message}`)
        .join('\n');
      throw new Error(`概念格式错误 → ${path}\n${detail}`);
    }

    const body = raw.slice(matched[0].length);
    return {
      id,
      ...result.data,
      body: body.trim(),
      // 概念正文里的站内链接（如 /concepts/soft-delete）统一补上 base 前缀
      html: (marked.parse(body, { async: false }) as string).replaceAll('href="/', `href="${BASE}`),
    };
  });
}

/* ---------------------------------------------------------------- 组装 */

function toMap<T extends { id: string }>(rows: T[], errors: string[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (map.has(row.id)) errors.push(`${label} id 重复：${row.id}`);
    map.set(row.id, row);
  }
  return map;
}

function build(): Graph {
  const errors: string[] = [];
  const warnings: GraphWarning[] = [];
  const shots = loadShots();

  const screenRecords = toMap(loadRows(rawScreens, screenSchema, '界面'), errors, '界面');
  const ops = toMap(loadRows(rawOps, opSchema, '原子操作'), errors, '原子操作');
  const behaviors = toMap(loadRows(rawBehaviors, behaviorSchema, '行为'), errors, '行为');
  const tags = toMap(loadRows(rawTags, tagSchema, '标签'), errors, '标签');
  const categories = toMap(loadRows(rawCategories, categorySchema, '分类'), errors, '分类');
  const functions = loadRows(rawFunctions, functionSchema, '功能');
  const conceptList = loadConcepts(rawConcepts);
  const concepts = new Map(conceptList.map((concept) => [concept.id, concept]));

  toMap(functions, errors, '功能');

  // 界面层级：最多两级，父界面必须是一级界面
  for (const screen of screenRecords.values()) {
    if (!screen.parent) continue;
    if (screen.parent === screen.id) {
      errors.push(`界面 ${screen.id} 的亲界面不能是它自己`);
      continue;
    }
    const parent = screenRecords.get(screen.parent);
    if (!parent) {
      errors.push(`界面 ${screen.id} 的亲界面不存在：${screen.parent}`);
    } else if (parent.parent) {
      errors.push(`界面 ${screen.id} 的亲界面 ${screen.parent} 自己也是二级界面 —— 只支持两级`);
    }
  }

  // 路径由层级推导，不落盘
  const screens = new Map<string, Screen>(
    [...screenRecords.values()].map((screen) => {
      const parent = screen.parent ? screenRecords.get(screen.parent) : undefined;
      return [screen.id, { ...screen, route: parent ? `${parent.name} → ${screen.name}` : screen.name }];
    }),
  );

  // 原子操作 → 界面、关键字
  const opsWithoutShot = new Map<string, string[]>();

  for (const op of ops.values()) {
    if (!screens.has(op.screen)) {
      errors.push(`原子操作 ${op.id} 指向不存在的界面：${op.screen}`);
    }
    for (const keyword of op.keywords) {
      if (!concepts.has(keyword)) {
        errors.push(`原子操作 ${op.id} 的关键字指向不存在的概念：${keyword}`);
      }
    }
    if (!op.hotspot) {
      warnings.push({
        kind: 'hotspot',
        title: op.short,
        id: op.id,
        location: `ops.yaml · ${op.id}`,
      });
    }
    if (!op.image && !shots.get(op.screen)?.length) {
      const list = opsWithoutShot.get(op.screen) ?? [];
      list.push(op.id);
      opsWithoutShot.set(op.screen, list);
    }
  }

  // 按界面聚合：一个界面缺图只提醒一次，而不是每个操作刷一条
  for (const screenId of opsWithoutShot.keys()) {
    warnings.push({
      kind: 'image',
      title: screens.get(screenId)?.name ?? screenId,
      id: screenId,
      location: `shots/${screenId}-1.png`,
    });
  }

  // 行为 → 界面、原子操作
  for (const behavior of behaviors.values()) {
    if (!screens.has(behavior.screen)) {
      errors.push(`行为 ${behavior.id} 指向不存在的界面：${behavior.screen}`);
    }
    for (const opId of behavior.ops) {
      const op = ops.get(opId);
      if (!op) {
        errors.push(`行为 ${behavior.id} 引用了不存在的原子操作：${opId}`);
        continue;
      }
      if (op.screen !== behavior.screen) {
        errors.push(
          `行为 ${behavior.id} 在界面 ${behavior.screen}，但它的原子操作 ${opId} 属于 ${op.screen} —— 一个行为不能跨界面`,
        );
      }
    }
    for (const tag of behavior.tags) {
      if (!tags.has(tag)) {
        errors.push(`行为 ${behavior.id} 的标签「${tag}」没有在标签词典里登记`);
      }
    }
  }

  // 功能 → 行为
  for (const fn of functions) {
    for (const behaviorId of fn.behaviors) {
      if (!behaviors.has(behaviorId)) {
        errors.push(`功能 ${fn.id} 引用了不存在的行为：${behaviorId}`);
      }
    }
    if (!categories.has(fn.category)) {
      errors.push(`功能 ${fn.id} 的分类「${fn.category}」没有在分类词典里登记`);
    }
  }

  // 概念词条之间的引用
  for (const concept of conceptList) {
    for (const related of concept.related) {
      if (!concepts.has(related)) {
        errors.push(`概念 ${concept.id} 关联了不存在的概念：${related}`);
      }
    }
  }

  // 功能涉及的概念不单独声明：它是该功能所有原子操作关键字的并集，
  // 顺序按第一次出现。这样「覆盖」是结构上成立的，不需要额外校验。
  const coverage: Coverage[] = functions.map((fn) => {
    const provided = new Set<string>();
    for (const behaviorId of fn.behaviors) {
      const behavior = behaviors.get(behaviorId);
      if (!behavior) continue;
      for (const opId of behavior.ops) {
        for (const keyword of ops.get(opId)?.keywords ?? []) provided.add(keyword);
      }
    }
    return {
      fnId: fn.id,
      declared: [...provided],
      provided: [...provided].sort(),
      gaps: [],
    };
  });

  // 没有任何功能引用的概念，读者可能永远看不到
  const referenced = new Set(coverage.flatMap((item) => item.declared));
  for (const concept of conceptList) {
    if (!referenced.has(concept.id)) {
      warnings.push({
        kind: 'concept',
        title: concept.title,
        id: concept.id,
        location: `concepts/${concept.id}.md`,
      });
    }
  }

  // 登记了却没有行为使用的标签，多半是写了没接上
  const usedTags = new Set([...behaviors.values()].flatMap((behavior) => behavior.tags));
  for (const tag of tags.values()) {
    if (!usedTags.has(tag.id)) {
      warnings.push({
        kind: 'tag',
        title: tag.label,
        id: tag.id,
        location: `tags.yaml · ${tag.id}`,
      });
    }
  }

  const usedCategories = new Set(functions.map((fn) => fn.category));
  for (const category of categories.values()) {
    if (!usedCategories.has(category.id)) {
      warnings.push({
        kind: 'category',
        title: category.label,
        id: category.id,
        location: `categories.yaml · ${category.id}`,
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `内容校验失败（${errors.length} 项）\n\n${errors.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    );
  }

  let steps = 0;
  for (const fn of functions) {
    for (const behaviorId of fn.behaviors) {
      steps += behaviors.get(behaviorId)?.ops.length ?? 0;
    }
  }

  return {
    screens,
    ops,
    behaviors,
    functions,
    concepts,
    tags,
    categories,
    shots,
    coverage,
    warnings,
    stats: {
      screens: screens.size,
      behaviors: behaviors.size,
      ops: ops.size,
      functions: functions.length,
      concepts: concepts.size,
      steps,
    },
  };
}

let cached: Graph | undefined;

/** 全站共用一份图；校验只在第一次取用时跑一次。 */
export function getGraph(): Graph {
  return (cached ??= build());
}

export function functionUrl(id: string): string {
  return withBase(`/functions/${id}`);
}

export function conceptUrl(id: string): string {
  return withBase(`/concepts/${id}`);
}

export function screenUrl(id?: string): string {
  return withBase('/screens') + (id ? `#${id}` : '');
}

/** 原子操作实际用哪张图：自己指定了就用，否则退到所在界面的默认截图（编号最小的那张） */
export function opImage(graph: Graph, op: Op): string | undefined {
  return op.image ?? graph.shots.get(op.screen)?.[0];
}

/** public/ 下的静态资源（截图等），入参写相对 public/ 的路径即可 */
export function assetUrl(path: string): string {
  return withBase(`/${path.replace(/^\/+/, '')}`);
}

/** 从图里取一个功能；取不到就是内容有错，直接抛。 */
export function findFunction(graph: Graph, id: string): Func {
  const found = graph.functions.find((fn) => fn.id === id);
  if (!found) throw new Error(`找不到功能：${id}`);
  return found;
}

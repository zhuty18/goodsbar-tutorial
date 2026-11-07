import type { Behavior, Category, Concept, Func, Graph, Op, Screen, Tag } from './graph';

/**
 * 组装层：把「功能 → 行为 → 原子操作」展开成页面直接能渲染的视图模型。
 *
 * 这一层不关心界面长什么样，页面组件也不关心数据怎么关联。
 * 想换一种呈现方式（比如做成走查模式、导出成 PDF），改这里就够了。
 */

export interface Step {
  no: number;
  op: Op;
  screen: Screen;
  /** 这一步引用的全部概念 */
  concepts: Concept[];
  /** 第一次出现在这一步的概念——页面要在这里插入释义，而不是在页首堆一排标签 */
  introduces: Concept[];
}

/** 行为：原子操作的有序序列，不出现在功能之外 */
export interface Section {
  no: number;
  behavior: Behavior;
  screen: Screen;
  steps: Step[];
  concepts: Concept[];
  /** 行为级标签：固定位是界面（screen），自定义位是这里 */
  tags: Tag[];
}

export interface FunctionPage {
  fn: Func;
  /** 功能分类：卡片和页首角标取 label 的首字 */
  category: Category;
  sections: Section[];
  steps: Step[];
  concepts: Concept[];
  screens: Screen[];
  /** 功能级标签：所有行为自定义标签的合集，按首次出现排序 */
  tags: Tag[];
}

export function composeFunction(graph: Graph, fn: Func): FunctionPage {
  const steps: Step[] = [];
  const screens: Screen[] = [];
  const seen = new Set<string>();

  const sections = fn.behaviors.map((behaviorId, index) => {
    const behavior = graph.behaviors.get(behaviorId);
    if (!behavior) throw new Error(`功能 ${fn.id} 引用了不存在的行为：${behaviorId}`);

    const screen = graph.screens.get(behavior.screen);
    if (!screen) throw new Error(`行为 ${behavior.id} 引用了不存在的界面：${behavior.screen}`);

    if (!screens.some((item) => item.id === screen.id)) screens.push(screen);

    const sectionSteps: Step[] = behavior.ops.map((opId, opIndex) => {
      const op = graph.ops.get(opId);
      if (!op) throw new Error(`行为 ${behavior.id} 引用了不存在的原子操作：${opId}`);

      const concepts = op.keywords.map((keyword) => {
        const concept = graph.concepts.get(keyword);
        if (!concept) throw new Error(`原子操作 ${op.id} 的关键字指向不存在的概念：${keyword}`);
        return concept;
      });

      const introduces = concepts.filter((concept) => !seen.has(concept.id));
      for (const concept of introduces) seen.add(concept.id);

      const step: Step = {
        no: opIndex + 1,
        op,
        screen,
        concepts,
        introduces,
      };

      steps.push(step);
      return step;
    });

    const sectionTags = behavior.tags.map((tagId) => {
      const tag = graph.tags.get(tagId);
      if (!tag) throw new Error(`行为 ${behavior.id} 的标签不在词典里：${tagId}`);
      return tag;
    });

    return {
      no: index + 1,
      behavior,
      screen,
      steps: sectionSteps,
      concepts: [...new Set(sectionSteps.flatMap((step) => step.concepts))],
      tags: sectionTags,
    };
  });

  const category = graph.categories.get(fn.category);
  if (!category) throw new Error(`功能 ${fn.id} 的分类不在词典里：${fn.category}`);

  return {
    fn,
    category,
    sections,
    steps,
    concepts: [...new Set(sections.flatMap((section) => section.concepts))],
    screens,
    tags: [
      ...new Map(sections.flatMap((section) => section.tags).map((tag) => [tag.id, tag])).values(),
    ],
  };
}

/** 概念页的反向链接：这个术语在哪些功能的哪些行为里被用到。 */
export function conceptBacklinks(graph: Graph, conceptId: string): { fn: Func; ops: Op[] }[] {
  return graph.functions.flatMap((fn) => {
    const ops = new Map<string, Op>();

    for (const behaviorId of fn.behaviors) {
      const behavior = graph.behaviors.get(behaviorId);
      if (!behavior) continue;
      for (const opId of behavior.ops) {
        const op = graph.ops.get(opId);
        if (op?.keywords.includes(conceptId)) ops.set(op.id, op);
      }
    }

    return ops.size > 0 ? [{ fn, ops: [...ops.values()] }] : [];
  });
}

/** 功能涉及的概念 = 它所有原子操作关键字的并集，按首次出现排序。 */
export function functionConceptIds(graph: Graph, fn: Func): string[] {
  const seen = new Set<string>();
  for (const behaviorId of fn.behaviors) {
    const behavior = graph.behaviors.get(behaviorId);
    if (!behavior) continue;
    for (const opId of behavior.ops) {
      for (const keyword of graph.ops.get(opId)?.keywords ?? []) seen.add(keyword);
    }
  }
  return [...seen];
}

/** 共享概念最多的其它功能，用作页面底部「可能也想知道」。 */
export function relatedFunctions(graph: Graph, fn: Func, limit = 3) {
  const own = new Set(functionConceptIds(graph, fn));

  return graph.functions
    .filter((other) => other.id !== fn.id)
    .map((other) => ({
      fn: other,
      shared: functionConceptIds(graph, other).filter((id) => own.has(id)),
    }))
    .filter((item) => item.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, limit);
}

/** 界面一览：按一级界面分组，组内一级界面在前，子界面按 id 排序。 */
export function screenGroups(graph: Graph) {
  const byId = (a: Screen, b: Screen) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const all = [...graph.screens.values()];

  return all
    .filter((screen) => !screen.parent)
    .sort(byId)
    .map((root) => ({
      root,
      children: all.filter((screen) => screen.parent === root.id).sort(byId),
    }));
}

/** 界面一览：每个界面承载了哪些行为。 */
export function screenUsage(graph: Graph) {
  return [...graph.screens.values()].map((screen) => {
    const entries: { fn: Func; behavior: Behavior }[] = [];

    for (const fn of graph.functions) {
      for (const behaviorId of fn.behaviors) {
        const behavior = graph.behaviors.get(behaviorId);
        if (behavior?.screen === screen.id) entries.push({ fn, behavior });
      }
    }

    const opIds = new Set(entries.flatMap((entry) => entry.behavior.ops));

    return { screen, entries, opCount: opIds.size };
  });
}

/** 概念被多少个功能用到。 */
export function conceptUsage(graph: Graph, conceptId: string): number {
  return graph.functions.filter((fn) => functionConceptIds(graph, fn).includes(conceptId)).length;
}

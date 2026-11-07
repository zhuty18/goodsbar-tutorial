import type { Graph } from './graph';
import { functionConceptIds } from './compose';

/**
 * 概念关联图谱：把概念之间的关系画成一张静态 SVG。
 *
 * 边有两种：
 *   同一功能 —— 两个概念在同一个功能里同时出现，出现一次算一次权重
 *   手工关联 —— 概念词条里 related 里写的
 *
 * 布局用 Fruchterman-Reingold，初始位置摆成一个圆，迭代中靠斥力/引力收敛，
 * 没有随机数，所以每次构建出来的图完全一致（diff 不会抖）。
 */

export interface ConceptNode {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  degree: number;
}

export interface ConceptEdge {
  source: string;
  target: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  kind: 'co' | 'related';
}

export interface ConceptGraphLayout {
  width: number;
  height: number;
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

const WIDTH = 900;
const HEIGHT = 520;
const PADDING = 90;
const ITERATIONS = 320;

export function layoutConceptGraph(graph: Graph): ConceptGraphLayout {
  const concepts = [...graph.concepts.values()];
  const n = concepts.length;

  if (n === 0) return { width: WIDTH, height: HEIGHT, nodes: [], edges: [] };

  const position = new Map<string, { x: number; y: number }>();
  const radius = Math.min(WIDTH, HEIGHT) / 2 - PADDING;
  concepts.forEach((concept, index) => {
    const angle = (index / n) * Math.PI * 2;
    position.set(concept.id, {
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
    });
  });

  /* ------------------------------------------------------------ 取边 */

  const edges = new Map<string, { source: string; target: string; weight: number; kind: 'co' | 'related' }>();

  const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const fn of graph.functions) {
    const ids = functionConceptIds(graph, fn);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = keyOf(ids[i], ids[j]);
        const edge = edges.get(key) ?? { source: ids[i], target: ids[j], weight: 0, kind: 'co' as const };
        edge.weight += 1;
        edges.set(key, edge);
      }
    }
  }

  for (const concept of concepts) {
    for (const related of concept.related) {
      if (related === concept.id || !graph.concepts.has(related)) continue;
      const key = keyOf(concept.id, related);
      const edge = edges.get(key);
      if (edge) edge.kind = 'related';
      else edges.set(key, { source: concept.id, target: related, weight: 1, kind: 'related' });
    }
  }

  const edgeList = [...edges.values()];

  /* ------------------------------------------------------------ 布局 */

  const area = WIDTH * HEIGHT;
  const k = Math.sqrt(area / n);
  const displacement = new Map<string, { x: number; y: number }>();
  let temperature = Math.min(WIDTH, HEIGHT) / 6;

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.max(0.01, Math.hypot(a.x - b.x, a.y - b.y));

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    for (const concept of concepts) displacement.set(concept.id, { x: 0, y: 0 });

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = position.get(concepts[i].id)!;
        const b = position.get(concepts[j].id)!;
        const d = distance(a, b);
        const force = (k * k) / d;
        const dx = ((a.x - b.x) / d) * force;
        const dy = ((a.y - b.y) / d) * force;

        const da = displacement.get(concepts[i].id)!;
        const db = displacement.get(concepts[j].id)!;
        da.x += dx;
        da.y += dy;
        db.x -= dx;
        db.y -= dy;
      }
    }

    for (const edge of edgeList) {
      const a = position.get(edge.source)!;
      const b = position.get(edge.target)!;
      const d = distance(a, b);
      const force = ((d * d) / k) * Math.min(edge.weight, 3) * 0.4;
      const dx = ((a.x - b.x) / d) * force;
      const dy = ((a.y - b.y) / d) * force;

      const da = displacement.get(edge.source)!;
      const db = displacement.get(edge.target)!;
      da.x -= dx;
      da.y -= dy;
      db.x += dx;
      db.y += dy;
    }

    for (const concept of concepts) {
      const point = position.get(concept.id)!;
      const move = displacement.get(concept.id)!;
      const length = Math.max(0.01, Math.hypot(move.x, move.y));
      const step = Math.min(length, temperature);
      point.x += (move.x / length) * step;
      point.y += (move.y / length) * step;

      point.x = Math.min(WIDTH - PADDING, Math.max(PADDING, point.x));
      point.y = Math.min(HEIGHT - PADDING, Math.max(PADDING, point.y));
    }

    temperature = Math.max(0.5, temperature * 0.985);
  }

  /* ------------------------------------------------------------ 归一化 */

  const xs = concepts.map((concept) => position.get(concept.id)!.x);
  const ys = concepts.map((concept) => position.get(concept.id)!.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const innerWidth = WIDTH - PADDING * 2;
  const innerHeight = HEIGHT - PADDING * 2;

  for (const concept of concepts) {
    const point = position.get(concept.id)!;
    point.x = PADDING + ((point.x - minX) / spanX) * innerWidth;
    point.y = PADDING + ((point.y - minY) / spanY) * innerHeight;
  }

  const degree = new Map<string, number>();
  for (const edge of edgeList) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.weight);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.weight);
  }

  const nodes: ConceptNode[] = concepts.map((concept) => {
    const point = position.get(concept.id)!;
    const weight = degree.get(concept.id) ?? 0;
    return {
      id: concept.id,
      label: concept.title,
      x: Math.round(point.x * 10) / 10,
      y: Math.round(point.y * 10) / 10,
      radius: Math.round((16 + Math.min(weight, 8) * 2.2) * 10) / 10,
      degree: weight,
    };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return {
    width: WIDTH,
    height: HEIGHT,
    nodes,
    edges: edgeList.map((edge) => {
      const a = nodeById.get(edge.source)!;
      const b = nodeById.get(edge.target)!;
      return {
        ...edge,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
      };
    }),
  };
}

/**
 * 截图路径的纯函数层：构建期（graph.ts）和编辑器（editor.astro）共用同一套命名规则。
 *
 * 这里不碰文件系统，入参是相对 public/ 的路径，比如 shots/business-hour-1.webp。
 *
 * 界面级截图的文件名认四种写法：
 *   <界面id>                    shots/business-hour.webp
 *   <界面id>-<数字>             shots/business-hour-1.webp
 *   <界面id>-<任意字符串>        shots/business-hour-close.webp
 *   <界面id>-<数字>-<任意字符串>  shots/business-hour-3-1.webp
 *
 * 操作级截图：
 *   <界面id>/<操作id>            shots/business-hour/pickup.webp
 *   <界面id>/<操作id>-<数字>     shots/business-hour/pickup-1.webp（同一操作的变体）
 *   界面目录下的任意层级          界面目录里的所有图片（编辑器里可手动选）
 */

export const IMAGE_PATTERN = /\.(png|jpe?g|webp)$/i;

export interface ShotScreen {
  id: string;
  parent?: string;
}

export interface ShotOp {
  id: string;
  screen: string;
}

export interface StemMatch {
  /** -1 = 不带编号；数字 = 编号；Infinity = 只有名字没有编号 */
  order: number;
  /** 编号后面的部分，没有就是空串 */
  tail: string;
}

/** 同名不同格式时的偏好：webp 最省，其次 jpg，最后 png */
export function extensionRank(file: string): number {
  const ext = file.toLowerCase().split('.').pop() ?? '';
  if (ext === 'webp') return 0;
  if (ext === 'jpg' || ext === 'jpeg') return 1;
  if (ext === 'png') return 2;
  return 3;
}

/** 去掉扩展名的文件名，比如 shots/business-hour-3-1.webp → business-hour-3-1 */
export function shotStem(file: string): string {
  const name = file.split('/').pop() ?? file;
  return name.replace(IMAGE_PATTERN, '');
}

/**
 * 把文件名和 id 对上，返回排序信息：
 *   <id>                 → -1
 *   <id>-<数字>          → 数字
 *   <id>-<数字>-<字符串>  → 数字 + 尾串
 *   <id>-<字符串>         → Infinity + 尾串（排在所有编号之后）
 */
export function matchIdStem(stem: string, id: string): StemMatch | null {
  if (!id) return null;
  if (stem === id) return { order: -1, tail: '' };
  if (!stem.startsWith(`${id}-`)) return null;

  const rest = stem.slice(id.length + 1);
  const numbered = /^(\d+)(?:-(.*))?$/.exec(rest);
  if (numbered) return { order: Number(numbered[1]), tail: numbered[2] ?? '' };
  return { order: Number.POSITIVE_INFINITY, tail: rest };
}

/** 一个文件名可能同时以两个界面 id 开头（比如 event 和 event-management），取最长的那个 */
export function matchScreenStem(stem: string, screenIds: Iterable<string>): string | undefined {
  let best: string | undefined;
  for (const id of screenIds) {
    if (!matchIdStem(stem, id)) continue;
    if (!best || id.length > best.length) best = id;
  }
  return best;
}

interface OrderedShot {
  order: number;
  tail: string;
  file: string;
}

/** 编号小的在前；同编号按尾串；再按路径。Infinity 不能直接相减（会得到 NaN）。 */
function compareShots(a: OrderedShot, b: OrderedShot): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.tail.localeCompare(b.tail) || a.file.localeCompare(b.file);
}

/** 同一个文件名有多种格式时只留一张：webp > jpg > png，同格式按路径定胜负 */
function preferFile(current: string | undefined, candidate: string): string {
  if (!current) return candidate;
  const diff = extensionRank(candidate) - extensionRank(current);
  if (diff !== 0) return diff < 0 ? candidate : current;
  return candidate.localeCompare(current) < 0 ? candidate : current;
}

/**
 * 一个界面的界面级截图，按“默认图在前”排好。
 *
 * 只按文件名匹配，不限制目录：这样二级界面既可以把图放在父界面目录里
 * （shots/<父界面id>/<界面id>-1.webp），也可以放在自己的目录里
 * （shots/<父界面id>/<界面id>/<界面id>-1.webp）。
 */
export function screenShotList(
  files: string[],
  screenId: string,
  screenIds: Iterable<string>,
): string[] {
  const ids = [...screenIds];
  if (!ids.includes(screenId)) ids.push(screenId);

  const picked = new Map<string, string>();
  for (const file of files) {
    if (!IMAGE_PATTERN.test(file)) continue;
    const stem = shotStem(file);
    if (matchScreenStem(stem, ids) !== screenId) continue;
    if (!matchIdStem(stem, screenId)) continue;
    // 同目录同名不同格式只留一张；不同目录的同名图都保留
    const key = file.replace(IMAGE_PATTERN, '');
    picked.set(key, preferFile(picked.get(key), file));
  }

  return [...picked.values()]
    .map((file) => ({ ...matchIdStem(shotStem(file), screenId)!, file }))
    .sort(compareShots)
    .map((shot) => shot.file);
}

/** 二级界面的操作级截图可能放在父目录下，也可能放在自己的目录下 */
function screenRoots(files: string[], screenId: string, screen?: ShotScreen): string[] {
  const roots = new Set<string>();
  if (screenId) roots.add(`shots/${screenId}/`);
  if (screen?.parent) roots.add(`shots/${screen.parent}/${screen.id}/`);

  // <界面id> 也可能出现在更深的层级里（shots/a/b/<界面id>/…），一律算它的目录
  if (screenId) {
    for (const file of files) {
      const parts = file.split('/');
      for (let index = 1; index < parts.length - 1; index += 1) {
        if (parts[index] === screenId) {
          roots.add(`${parts.slice(0, index + 1).join('/')}/`);
        }
      }
    }
  }

  return [...roots];
}

export interface OpShotInfo {
  /** 这个操作自己的截图（<操作id> 或 <操作id>-…），没有就 undefined */
  best?: string;
  /** 编辑器截图下拉里能选的所有图：自己的、界面级的、界面目录下的全部文件 */
  candidates: string[];
}

/**
 * 一个操作可用的截图。
 *
 * 自己的截图按 <操作id>、<操作id>-<数字>、<操作id>-<任意字符串> 匹配，
 * 只在这个界面的目录里找，并且跳过已经属于某个界面的图（界面级优先）。
 * 候选清单按优先级排：自己的 → 界面级 → 界面目录下的其它文件。
 */
export function opShotInfo(
  files: string[],
  op: ShotOp,
  screens: Iterable<ShotScreen>,
  ops: Iterable<ShotOp>,
): OpShotInfo {
  const screenList = [...screens];
  const screenIds = screenList.map((screen) => screen.id).filter(Boolean);
  if (op.screen && !screenIds.includes(op.screen)) screenIds.push(op.screen);

  const screenLevel = op.screen ? screenShotList(files, op.screen, screenIds) : [];
  const screen = screenList.find((item) => item.id === op.screen);
  const roots = screenRoots(files, op.screen, screen);
  const dirFiles = files.filter(
    (file) => IMAGE_PATTERN.test(file) && roots.some((root) => file.startsWith(root)),
  );

  // 文件名已经能对上某个界面的，算界面级截图，不再当作操作截图
  const claimed = new Set<string>();
  for (const file of files) {
    if (!IMAGE_PATTERN.test(file)) continue;
    const stem = shotStem(file);
    if (matchScreenStem(stem, screenIds)) claimed.add(stem);
  }

  // 同一个界面里别的操作 id 是精确文件名时，不要把它当成这个操作的变体
  const siblingIds = new Set<string>();
  for (const sibling of ops) {
    if (sibling.screen === op.screen && sibling.id) siblingIds.add(sibling.id);
  }

  const specific = new Map<string, string>();
  if (op.id) {
    for (const file of dirFiles) {
      const stem = shotStem(file);
      if (claimed.has(stem)) continue;
      if (stem !== op.id && siblingIds.has(stem)) continue;
      if (!matchIdStem(stem, op.id)) continue;
      // 同目录同名不同格式只留一张；不同目录的同名图都保留
      const key = file.replace(IMAGE_PATTERN, '');
      specific.set(key, preferFile(specific.get(key), file));
    }
  }

  const ownShots = [...specific.values()]
    .map((file) => ({ ...matchIdStem(shotStem(file), op.id)!, file }))
    .sort(compareShots)
    .map((shot) => shot.file);

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const file of [...ownShots, ...screenLevel, ...[...dirFiles].sort((a, b) => a.localeCompare(b))]) {
    if (seen.has(file)) continue;
    seen.add(file);
    candidates.push(file);
  }

  return { best: ownShots[0], candidates };
}

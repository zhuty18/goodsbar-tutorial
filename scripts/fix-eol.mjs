/**
 * 把仓库里的文本文件统一成 CRLF。
 *
 * 存在的意义：各种工具（编辑器、脚本、生成器）默认写 LF，混用之后 git diff
 * 会被换行符淹没。跑一次 `pnpm eol` 就全部拉回 CRLF。
 *
 * 跳过：node_modules / dist / .git / .astro / .pnpm-store / bundles（导出的数据包）、
 * 二进制文件，以及 pnpm-lock.yaml（.gitattributes 里固定成 LF，且由 pnpm 自己维护）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.astro', '.pnpm-store', 'bundles']);
const TEXT_EXT = new Set([
  '.astro', '.md', '.yaml', '.yml', '.ts', '.js', '.mjs', '.json',
  '.py', '.css', '.html', '.txt', '.gitattributes', '.gitignore', '.npmrc',
]);
const SKIP_FILES = new Set(['pnpm-lock.yaml']);

const changed = [];
const scanned = [];
const skipped = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }

    const ext = path.extname(entry.name);
    const isSpecial = entry.name === '.gitattributes' || entry.name === '.gitignore' || entry.name === '.npmrc';
    if (!TEXT_EXT.has(ext) && !isSpecial) continue;
    if (SKIP_FILES.has(entry.name)) continue;

    scanned.push(full);

    try {
      const text = fs.readFileSync(full, 'utf8');
      const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      if (normalized !== text) {
        fs.writeFileSync(full, normalized, 'utf8');
        changed.push(path.relative(process.cwd(), full));
      }
    } catch (error) {
      // 单个文件写不了不该让整轮失败（比如被别的程序占着）
      skipped.push(`${path.relative(process.cwd(), full)}（${error.code ?? error.message}）`);
    }
  }
}

walk('.');

console.log(`扫描 ${scanned.length} 个文本文件，转换 ${changed.length} 个`);
for (const file of changed) console.log(`  ${file}`);
if (skipped.length > 0) {
  console.log(`跳过 ${skipped.length} 个读不了的文件：`);
  for (const file of skipped) console.log(`  ${file}`);
}

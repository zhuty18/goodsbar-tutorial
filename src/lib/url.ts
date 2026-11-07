/**
 * 站点部署在子路径下（astro.config.mjs 的 base），所有站内链接都要带上这个前缀。
 * 只在一个地方读 BASE_URL，别在页面里手写 '/functions/xxx'。
 */
export const BASE = import.meta.env.BASE_URL; // 以 / 结尾，例如 '/goodsbar-tutorial/'

export function withBase(path: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path) || path.startsWith('#')) {
    return path;
  }
  return BASE + path.replace(/^\/+/, '');
}

/** 把当前路径里的 base 去掉，用于导航高亮判断。 */
export function stripBase(pathname: string): string {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  return `/${rest.replace(/^\/+/, '')}`;
}

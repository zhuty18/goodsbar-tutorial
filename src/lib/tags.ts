/**
 * 标签系统：标签绑在**行为**上，分两种位置。
 *
 *  固定位 —— 预先声明维度，有结构化的取值，页面上有独立展示位置。
 *            界面是第一例：功能页会把它汇总成「涉及页面」。
 *  自定义位 —— 取自标签词典的 id，显示时查 label；不承担任何路由或结构职责。
 *
 * 行为：原子操作的有序序列，限定在一个界面内，没有独立展示，只挂靠在功能下。
 * 概念不是标签。概念是需要在正文里被解释的知识点，由原子操作的关键字引用，
 * 只在第一次出现时插入释义。两者不要混用。
 */

export interface FixedSlot {
  id: string;
  label: string;
  /** pages：在功能页汇总成「涉及页面」区块 */
  region: 'pages';
  description: string;
}

export const FIXED_SLOTS: FixedSlot[] = [
  {
    id: 'screen',
    label: '界面',
    region: 'pages',
    description: '这一步发生在哪个界面上。一个行为不跨界面。',
  },
];

/** 固定位里目前唯一稳定的一个：界面。页面用它给「涉及页面」区块打标。 */
export const SCREEN_SLOT = FIXED_SLOTS[0];

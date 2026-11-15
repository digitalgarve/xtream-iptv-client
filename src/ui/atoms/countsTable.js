import { h, cx } from '../dom.js';

/**
 * A table of counts in columns (`.counts-table`): a label over each value, the buttons (remove / refresh) at the right end.
 * `columns`: [label]. Returns { el, set(values) } (values: text per column, in the same order; '—' when unknown).
 */
export function createCountsTable({ columns, buttons = null, className = '' }) {
  const values = columns.map(() => h('span', { class: 'counts-value', text: '—' }));
  const cells = columns.map((label, i) => h('div', { class: 'counts-cell' }, h('span', { class: 'counts-label', text: label }), values[i]));
  const el = h('div', { class: cx('counts-table', className) }, h('div', { class: 'counts-cells' }, cells), buttons ? h('div', { class: 'counts-buttons' }, buttons) : null);
  return {
    el,
    set(list) {
      values.forEach((node, i) => {
        const text = list[i] === undefined || list[i] === null || list[i] === '' ? '—' : String(list[i]);
        if (node.textContent !== text) node.textContent = text;
      });
    },
  };
}

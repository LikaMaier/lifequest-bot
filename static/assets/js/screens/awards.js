import { h, clear } from '../dom.js';
import { emptyState } from '../ui.js';

export function render(el) {
  clear(el);
  el.append(emptyState('Этот раздел скоро появится ✨'));
}
export const renderPremium = render;

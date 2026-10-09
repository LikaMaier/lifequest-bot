// Inline SVG-иконки (24×24, обводка currentColor). Только константы.

const wrap = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  home: wrap('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1v-9"/>'),
  quests: wrap('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12.5l2.2 2.2L15.5 10"/>'),
  board: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>'),
  progress: wrap('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  awards: wrap('<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4v3h-4z"/>'),
  habits: wrap('<path d="M12 3c3 4 6 7 6 10.5A6 6 0 0 1 6 13.5C6 10 9 7 12 3z"/><path d="M9.5 14l1.8 1.8 3.4-3.6"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  minus: wrap('<path d="M5 12h14"/>'),
  heart: wrap('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>'),
  heartFill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/></svg>',
  reroll: wrap('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
  check: wrap('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>'),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  share: wrap('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>'),
  crown: wrap('<path d="M4 8l4 4 4-7 4 7 4-4-2 11H6z"/>'),
  settings: wrap('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>'),
  lock: wrap('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  flame: wrap('<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-4.5 4-6 3.5-11 3 1.5 5 4 5.5 6.5.6-1 .8-2 .8-3 2 1.7 3.2 4.3 3.2 7.5 0 3.4-2.5 6-6.5 6z"/>'),
};

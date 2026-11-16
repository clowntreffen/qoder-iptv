// Theme registry. The palette lives in src/styles/main.css as
// html[data-theme="<id>"] blocks; this list only drives the Settings picker
// and validates stored values.

export const THEMES = [
  { id: 'midnight', name: 'Midnight' },
  { id: 'ember', name: 'Ember' },
  { id: 'emerald', name: 'Emerald' },
  { id: 'amethyst', name: 'Amethyst' },
  { id: 'arctic', name: 'Arctic' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'plum', name: 'Plum Night' },
  { id: 'daylight', name: 'Daylight' }
];

export const DEFAULT_THEME = 'midnight';

export function isValidTheme(id) {
  return THEMES.some((theme) => theme.id === id);
}

export function themeName(id) {
  const theme = THEMES.find((item) => item.id === id);
  return theme ? theme.name : THEMES[0].name;
}

export const themes = Object.freeze({
  aurora: Object.freeze({ colors: Object.freeze([170, 195, 235, 275, 315]), background: Object.freeze(['#070e18', '#120e20']) }),
  ember: Object.freeze({ colors: Object.freeze([12, 24, 40, 340, 355]), background: Object.freeze(['#190d0c', '#100b15']) }),
  ocean: Object.freeze({ colors: Object.freeze([175, 190, 205, 220, 250]), background: Object.freeze(['#06121b', '#070f1e']) }),
});
export const palettes = Object.freeze(Object.fromEntries(Object.entries(themes).map(([id, theme]) => [id, theme.colors])));

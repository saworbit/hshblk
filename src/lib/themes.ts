/**
 * A theme is six colours, one for each token in src/styles.css.
 *
 * Paper and Ink are the reader's own. The rest come from Omarchy's themes (MIT), each after
 * its upstream project. Their dim text is mixed from their own text and page colours, and
 * three accents are swapped or darkened, so every colour that sets text passes WCAG AA.
 */
export type Palette = {
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  rule: string;
  code: string;
};

export type Theme = { id: string; name: string; mode: "light" | "dark"; palette: Palette };

const PAPER: Theme = {
  id: "paper",
  name: "Paper",
  mode: "light",
  palette: {
    paper: "#f3eee6",
    ink: "#1c1915",
    muted: "#6c6459",
    accent: "#8f3d2b",
    rule: "#e4d9c8",
    code: "#ebe4d6",
  },
};

const INK: Theme = {
  id: "ink",
  name: "Ink",
  mode: "dark",
  palette: {
    paper: "#1c1915",
    ink: "#ebe3d5",
    muted: "#948e84",
    accent: "#e08c71",
    rule: "#3a332b",
    code: "#27231e",
  },
};

export const THEMES: Theme[] = [
  PAPER,
  {
    id: "flexoki-light",
    name: "Flexoki Light",
    mode: "light",
    palette: {
      paper: "#fffcf0",
      ink: "#100f0f",
      muted: "#63615d",
      accent: "#205ea6",
      rule: "#cecdc3",
      code: "#e6e4d9",
    },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    mode: "light",
    palette: {
      paper: "#eff1f5",
      ink: "#4c4f69",
      muted: "#5b5d76",
      accent: "#2363e6",
      rule: "#ccd0da",
      code: "#dce0e8",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    mode: "light",
    palette: {
      paper: "#faf4ed",
      ink: "#575279",
      muted: "#676184",
      accent: "#286983",
      rule: "#dfdad9",
      code: "#f2e9e1",
    },
  },
  INK,
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    palette: {
      paper: "#1a1b26",
      ink: "#a9b1d6",
      muted: "#8c93b2",
      accent: "#7aa2f7",
      rule: "#292e42",
      code: "#24283b",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    mode: "dark",
    palette: {
      paper: "#1e1e2e",
      ink: "#cdd6f4",
      muted: "#99a0b9",
      accent: "#89b4fa",
      rule: "#45475a",
      code: "#313244",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    mode: "dark",
    palette: {
      paper: "#282828",
      ink: "#d4be98",
      muted: "#b7a585",
      accent: "#7daea3",
      rule: "#504945",
      code: "#3c3836",
    },
  },
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    palette: {
      paper: "#2e3440",
      ink: "#d8dee9",
      muted: "#aeb4bf",
      accent: "#81a1c1",
      rule: "#434c5e",
      code: "#3b4252",
    },
  },
  {
    id: "everforest",
    name: "Everforest",
    mode: "dark",
    palette: {
      paper: "#2d353b",
      ink: "#d3c6aa",
      muted: "#b6ac96",
      accent: "#7fbbb3",
      rule: "#3d484d",
      code: "#343f44",
    },
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    mode: "dark",
    palette: {
      paper: "#1f1f28",
      ink: "#dcd7ba",
      muted: "#a19e8c",
      accent: "#7e9cd8",
      rule: "#363646",
      code: "#223249",
    },
  },
  {
    id: "matte-black",
    name: "Matte Black",
    mode: "dark",
    palette: {
      paper: "#121212",
      ink: "#bebebe",
      muted: "#8a8a8a",
      accent: "#e68e0d",
      rule: "#2a2a2a",
      code: "#1e1e1e",
    },
  },
  {
    id: "ristretto",
    name: "Ristretto",
    mode: "dark",
    palette: {
      paper: "#2c2525",
      ink: "#e6d9db",
      muted: "#a79c9d",
      accent: "#f38d70",
      rule: "#403e41",
      code: "#3d2f2a",
    },
  },
  {
    id: "osaka-jade",
    name: "Osaka Jade",
    mode: "dark",
    palette: {
      paper: "#111c18",
      ink: "#c1c497",
      muted: "#9ea37e",
      accent: "#509475",
      rule: "#32473b",
      code: "#23372b",
    },
  },
];

/** No choice made: the page follows the system, Paper by day and Ink by night. */
export const SYSTEM = "system";

const STORE = "hshblk-theme";

export const THEME_CSS = [
  `:root:not([data-theme]) { ${declarations(PAPER)} }`,
  `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${declarations(INK)} } }`,
  ...THEMES.map((theme) => `:root[data-theme="${theme.id}"] { ${declarations(theme)} }`),
].join("\n");

/** Runs in the head, before the page paints, so a chosen theme never shows Paper first. */
export const THEME_SCRIPT = `try {
  var theme = localStorage.getItem(${JSON.stringify(STORE)});
  if (${JSON.stringify(THEMES.map((theme) => theme.id))}.indexOf(theme) > -1) {
    document.documentElement.dataset.theme = theme;
  }
} catch (error) {}`;

export function currentTheme(): string {
  return document.documentElement.dataset.theme ?? SYSTEM;
}

export function applyTheme(id: string): void {
  const root = document.documentElement;
  if (id === SYSTEM) delete root.dataset.theme;
  else root.dataset.theme = id;
  try {
    if (id === SYSTEM) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, id);
  } catch {
    // Storage is unavailable. The choice lasts until the page reloads.
  }
}

/** The order the `t` key steps through: the system's choice, then every theme. */
export function nextTheme(id: string): string {
  const order = [SYSTEM, ...THEMES.map((theme) => theme.id)];
  return order[(order.indexOf(id) + 1) % order.length];
}

function declarations({ mode, palette }: Theme): string {
  const tokens = Object.entries(palette).map(([token, value]) => `--color-${token}: ${value};`);
  return [`color-scheme: ${mode};`, ...tokens].join(" ");
}

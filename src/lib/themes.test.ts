import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextTheme, SYSTEM, THEME_CSS, THEMES } from "./themes.ts";

/** The WCAG 2 contrast ratio between two colours. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("themes", () => {
  for (const { name, palette } of THEMES) {
    it(`${name} sets every text colour at WCAG AA or better`, () => {
      const pairs = {
        "ink on paper": [palette.ink, palette.paper],
        "ink on code": [palette.ink, palette.code],
        "muted on paper": [palette.muted, palette.paper],
        "muted on code": [palette.muted, palette.code],
        "accent on paper": [palette.accent, palette.paper],
      };
      for (const [pair, [text, ground]] of Object.entries(pairs)) {
        const ratio = contrast(text, ground);
        assert.ok(ratio >= 4.5, `${pair} is ${ratio.toFixed(2)}:1`);
      }
      assert.ok(
        contrast(palette.muted, palette.paper) < contrast(palette.ink, palette.paper),
        "muted text is quieter than ink",
      );
    });
  }

  it("writes each colour as six hex digits", () => {
    for (const { name, palette } of THEMES) {
      for (const [token, value] of Object.entries(palette)) {
        assert.match(value, /^#[0-9a-f]{6}$/, `${name} ${token}`);
      }
    }
  });

  it("gives every theme its own id, and a rule in the stylesheet", () => {
    const ids = THEMES.map((theme) => theme.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(THEME_CSS.includes(`[data-theme="${id}"]`), id);
  });

  it("steps from the system's choice through every theme and back", () => {
    const seen = [SYSTEM];
    for (let id = nextTheme(SYSTEM); id !== SYSTEM; id = nextTheme(id)) seen.push(id);
    assert.deepEqual(seen, [SYSTEM, ...THEMES.map((theme) => theme.id)]);
    assert.equal(nextTheme("retired-theme"), SYSTEM);
  });
});

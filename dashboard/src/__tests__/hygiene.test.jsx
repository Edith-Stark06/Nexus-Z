import { describe, it, expect } from "vitest";

// Vite lists every file under src at build time, so this test sees the real source tree.
const styles = import.meta.glob("../**/*.css", { query: "?raw", import: "default", eager: true });
const sources = import.meta.glob("../**/*.{js,jsx}", { query: "?raw", import: "default", eager: true });

describe("the stylesheets", () => {
  it("every stylesheet is imported by something, so no component is left unstyled", () => {
    const code = Object.entries(sources).filter(([path]) => !path.includes("__tests__"));
    const orphans = Object.keys(styles).filter((css) => {
      const name = css.split("/").pop();
      return !code.some(([, text]) => text.includes(`/${name}"`) || text.includes(`/${name}'`) || text.includes(`"${name}"`));
    });
    expect(orphans).toEqual([]);
  });

  it("no page loads fonts or styles from another site, because the deployment's content policy blocks them", () => {
    for (const [path, text] of Object.entries({ ...styles, ...sources })) {
      if (path.includes("__tests__")) continue;
      expect(text, path).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import\s+url\(["']?https?:/);
    }
  });
});

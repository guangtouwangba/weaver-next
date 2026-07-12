import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLocale } from "../lib/i18n";

describe("Widget locale selection", () => {
  it("uses a persisted choice before browser preferences", () => {
    expect(resolveLocale("en-US", ["zh-CN"])).toBe("en-US");
  });

  it("defaults Chinese regions to zh-CN and all others to en-US", () => {
    expect(resolveLocale(null, ["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLocale(null, ["fr-FR", "en-US"])).toBe("en-US");
  });

  it("keeps user-visible JSX text in the locale resources", () => {
    const root = join(process.cwd(), "apps/widget/src/components");
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".tsx") ? [join(directory, entry.name)] : []);
    const violations = files(root).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/>\s*([A-Za-z\u3400-\u9fff][A-Za-z\u3400-\u9fff ]*)</g)].map((match) => ({ file, text: match[1].trim() })).filter(({ text }) => !["W", "WEAVER", "Weaver", "Promise"].includes(text)));
    expect(violations).toEqual([]);
  });
});

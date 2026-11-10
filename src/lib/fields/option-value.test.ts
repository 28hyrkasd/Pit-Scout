import { describe, expect, it } from "vitest";
import { nextOptionValue, slugifyOption } from "./option-value";

describe("slugifyOption", () => {
  it.each([
    ["Swerve", "swerve"],
    ["Tank / West Coast", "tank-west-coast"],
    ["High / Traversal", "high-traversal"],
    ["  spaced   out  ", "spaced-out"],
    ["Café", "cafe"],
    ["C++", "c"],
    ["6-wheel", "6-wheel"],
    ["UPPER", "upper"],
    ["a---b", "a-b"],
  ])("%j -> %j", (label, expected) => {
    expect(slugifyOption(label)).toBe(expected);
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugifyOption("???")).toBe("");
    expect(slugifyOption("🤖")).toBe("");
    expect(slugifyOption("   ")).toBe("");
  });

  it("caps length without leaving a trailing dash", () => {
    const slug = slugifyOption("word ".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("only ever produces [a-z0-9-]", () => {
    for (const label of ["Ünï©ode ✓", "a/b\\c", "tab\there", "quote\"s", "<script>"]) {
      expect(slugifyOption(label)).toMatch(/^[a-z0-9-]*$/);
    }
  });
});

describe("nextOptionValue", () => {
  it("uses the slug when free", () => {
    expect(nextOptionValue("Swerve", [])).toBe("swerve");
  });

  it("appends -2, -3 on collisions", () => {
    expect(nextOptionValue("Swerve", ["swerve"])).toBe("swerve-2");
    expect(nextOptionValue("Swerve", ["swerve", "swerve-2"])).toBe("swerve-3");
  });

  it("treats labels that differ only in case/punctuation as colliding", () => {
    expect(nextOptionValue("SWERVE!", ["swerve"])).toBe("swerve-2");
  });

  it("falls back to 'option' when the label has no usable characters", () => {
    expect(nextOptionValue("🤖", [])).toBe("option");
    expect(nextOptionValue("🤖", ["option"])).toBe("option-2");
  });

  it("accepts any iterable of taken values", () => {
    expect(nextOptionValue("A", new Set(["a"]))).toBe("a-2");
  });
});

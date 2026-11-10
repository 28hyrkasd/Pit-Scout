import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const publicDir = path.resolve(__dirname, "../../public");

/** Reads width/height from a PNG's IHDR chunk (bytes 16-23) and its colour type (byte 25). */
function pngInfo(file: string) {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

const m = manifest();
const icons = m.icons ?? [];

describe("web app manifest", () => {
  it("is installable-shaped: standalone, named, start_url inside scope", () => {
    expect(m.name).toBe("Pit Scout");
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBe("portrait");
    expect(m.id).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.start_url).toBeDefined();
    const start = new URL(m.start_url!, "https://example.test");
    const scope = new URL(m.scope!, "https://example.test");
    expect(start.pathname.startsWith(scope.pathname)).toBe(true);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("declares 192 and 512 'any' icons plus a 512 maskable icon", () => {
    const has = (sizes: string, purpose: string) =>
      icons.some((i) => i.sizes === sizes && i.purpose === purpose);
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
  });

  it.each(icons.map((i) => [i.src, i] as const))("icon %s exists on disk with the declared size", (_src, icon) => {
    expect(icon.type).toBe("image/png");
    expect(icon.src.startsWith("/")).toBe(true);
    const file = path.join(publicDir, icon.src);
    expect(existsSync(file)).toBe(true);
    const { width, height } = pngInfo(file);
    expect(`${width}x${height}`).toBe(icon.sizes);
  });

  it("serves icons from a path the auth proxy lets through signed-out", () => {
    // Keep in sync with the matcher exclusions in src/proxy.ts.
    for (const icon of icons) expect(icon.src).toMatch(/^\/icons\/|\.png$/);
  });

  it("ships an opaque apple-touch-icon at 180x180 and a favicon", () => {
    const apple = pngInfo(path.join(publicDir, "apple-touch-icon.png"));
    expect([apple.width, apple.height]).toEqual([180, 180]);
    // PNG colour type 2 = RGB (no alpha channel); 6 would be RGBA.
    expect(apple.colorType).toBe(2);
    const favicon = readFileSync(path.resolve(__dirname, "favicon.ico"));
    expect(favicon.readUInt16LE(0)).toBe(0); // reserved
    expect(favicon.readUInt16LE(2)).toBe(1); // type: icon
    expect(favicon.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
  });

  it("maskable icon is full-bleed and opaque (no alpha channel)", () => {
    expect(pngInfo(path.join(publicDir, "icons/maskable-512.png")).colorType).toBe(2);
  });
});

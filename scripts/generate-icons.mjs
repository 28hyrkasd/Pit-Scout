// Regenerates every Pit Scout icon from one geometry definition.
//
//   node scripts/generate-icons.mjs
//
// Outputs: public/icons/icon.svg, icon-192.png, icon-512.png, maskable-512.png,
// public/apple-touch-icon.png and src/app/favicon.ico (PNG-in-ICO, 16/32/48).
//
// Uses `sharp`, which is present in node_modules as a Next.js dependency. It is
// deliberately not a direct dependency of this project: icons are committed, so
// this script only needs to run when the mark changes.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BG = "#0a0a0a"; // matches the dark app background / dark theme-color
const ACCENT = "#fbbf24"; // amber: caution-tape / pit-lane yellow

const TEETH = 8;
const TIP_R = 170;
const ROOT_R = 138;
const HOLE_R = 94;

/** Gear outline: 8 trapezoid teeth around a root circle, centered on (256,256). */
function gearPath() {
  const step = (Math.PI * 2) / TEETH;
  const pts = [];
  for (let i = 0; i < TEETH; i++) {
    const a = i * step;
    // fractions of one tooth period: root ... rise ... tip ... fall ... root
    const marks = [
      [-0.5, ROOT_R],
      [-0.3, ROOT_R],
      [-0.17, TIP_R],
      [0.17, TIP_R],
      [0.3, ROOT_R],
    ];
    for (const [f, r] of marks) {
      const t = a + f * step;
      pts.push([256 + r * Math.sin(t), 256 - r * Math.cos(t)]);
    }
  }
  return `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
}

/** The mark itself: amber gear with a crosshair cut into its hub. */
function mark() {
  return `
    <path d="${gearPath()}" fill="${ACCENT}"/>
    <circle cx="256" cy="256" r="${HOLE_R}" fill="${BG}"/>
    <circle cx="256" cy="256" r="54" fill="none" stroke="${ACCENT}" stroke-width="16"/>
    <g stroke="${ACCENT}" stroke-width="16" stroke-linecap="round">
      <line x1="256" y1="186" x2="256" y2="226"/>
      <line x1="256" y1="286" x2="256" y2="326"/>
      <line x1="186" y1="256" x2="226" y2="256"/>
      <line x1="286" y1="256" x2="326" y2="256"/>
    </g>
    <circle cx="256" cy="256" r="12" fill="${ACCENT}"/>`;
}

/**
 * @param {{ scale: number, radius: number }} o
 *   scale  - artwork scale about the center (gear is ~66% of the canvas at 1.0)
 *   radius - background corner radius in 512-space (0 = full bleed square)
 */
function svg({ scale, radius }) {
  const rect =
    radius > 0
      ? `<rect width="512" height="512" rx="${radius}" fill="${BG}"/>`
      : `<rect width="512" height="512" fill="${BG}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Pit Scout</title>
  ${rect}
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${mark()}
  </g>
</svg>
`;
}

const ROUNDED = svg({ scale: 1.12, radius: 112 }); // "any" purpose icons + favicon
const FULL_BLEED_SAFE = svg({ scale: 0.9, radius: 0 }); // maskable: gear ~60% wide, inside the 66% safe zone
const FULL_BLEED = svg({ scale: 1.0, radius: 0 }); // apple-touch-icon: iOS rounds it itself

/** `opaque` drops the alpha channel entirely (true 3-channel RGB PNG). */
const png = (source, size, { opaque = false } = {}) => {
  let img = sharp(Buffer.from(source), { density: 384 }).resize(size, size);
  if (opaque) img = img.flatten({ background: BG }).removeAlpha();
  return img.png({ compressionLevel: 9 }).toBuffer();
};

/** Minimal ICO container holding PNG images (supported by all modern browsers). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

await mkdir(path.join(root, "public/icons"), { recursive: true });

await writeFile(path.join(root, "public/icons/icon.svg"), ROUNDED);
await writeFile(path.join(root, "public/icons/icon-192.png"), await png(ROUNDED, 192));
await writeFile(path.join(root, "public/icons/icon-512.png"), await png(ROUNDED, 512));
await writeFile(path.join(root, "public/icons/maskable-512.png"), await png(FULL_BLEED_SAFE, 512, { opaque: true }));
await writeFile(path.join(root, "public/apple-touch-icon.png"), await png(FULL_BLEED, 180, { opaque: true }));

const faviconSizes = [16, 32, 48];
const faviconImages = await Promise.all(
  faviconSizes.map(async (size) => ({ size, data: await png(ROUNDED, size) })),
);
await writeFile(path.join(root, "src/app/favicon.ico"), ico(faviconImages));

console.log("icons written");

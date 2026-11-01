#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const outputDirectory = "public/pwa";
const brandMarkPath = "public/brand/pipeline-mark.svg";
const appIconMarkWidthRatio = 0.46;
const appIconHorizontalNudgeRatio = 0.01;
const tokens = await readFile("app/design-tokens.css", "utf8");
const token = (name) => {
  const value = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`Missing design token: ${name}`);
  return value;
};
const backgroundColor = token("color-night");
const markColor = token("color-paper");

const brandMark = await loadImage(brandMarkPath);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  renderAppIcon(32, `${outputDirectory}/pipeline-favicon-32-v4.png`, 0.54),
  renderAppIcon(192, `${outputDirectory}/pipeline-app-icon-192-v12.png`),
  renderAppIcon(512, `${outputDirectory}/pipeline-app-icon-512-v12.png`),
  renderAppIcon(1024, `${outputDirectory}/pipeline-app-icon-1024-v12.png`),
]);

async function renderAppIcon(size, outputPath, widthRatio = appIconMarkWidthRatio) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const markWidth = Math.round(size * widthRatio);
  const markHeight = Math.round((markWidth * brandMark.height) / brandMark.width);
  const x = Math.round((size - markWidth) / 2);
  const y = Math.round((size - markHeight) / 2);

  const markCanvas = createCanvas(size, size);
  const markContext = markCanvas.getContext("2d");
  markContext.imageSmoothingEnabled = true;
  markContext.imageSmoothingQuality = "high";
  markContext.drawImage(brandMark, x, y, markWidth, markHeight);
  markContext.globalCompositeOperation = "source-in";

  markContext.fillStyle = markColor;
  markContext.fillRect(x, y, markWidth, markHeight);

  const bounds = alphaBounds(markContext, size);
  const offsetX = Math.round((size - 1 - bounds.left - bounds.right) / 2 + size * appIconHorizontalNudgeRatio);
  const offsetY = Math.round((size - 1 - bounds.top - bounds.bottom) / 2);
  context.drawImage(markCanvas, offsetX, offsetY);

  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

function alphaBounds(context, size) {
  const pixels = context.getImageData(0, 0, size, size).data;
  let left = size;
  let top = size;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = pixels[(y * size + x) * 4 + 3];
      if (alpha === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return { left: 0, top: 0, right: size - 1, bottom: size - 1 };
  return { left, top, right, bottom };
}

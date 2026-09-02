#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const outputDirectory = "public/pwa";
const brandMarkPath = "public/brand/pipeline-mark.svg";
const appIconMarkWidthRatio = 0.36;

const brandMark = await loadImage(brandMarkPath);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  renderIcon(192, 0.18, `${outputDirectory}/icon-192.png`),
  renderIcon(512, 0.18, `${outputDirectory}/icon-512.png`),
  renderIcon(512, 0.2, `${outputDirectory}/icon-maskable-512.png`, "#ffffff"),
  renderIcon(192, 0.18, `${outputDirectory}/pipeline-icon-192-v2.png`),
  renderIcon(512, 0.18, `${outputDirectory}/pipeline-icon-512-v2.png`),
  renderIcon(512, 0.2, `${outputDirectory}/pipeline-icon-maskable-512-v2.png`, "#ffffff"),
  renderFavicon(`${outputDirectory}/pipeline-favicon-32-v3.png`),
  renderAppIcon(192, `${outputDirectory}/pipeline-app-icon-192-v9.png`),
  renderAppIcon(512, `${outputDirectory}/pipeline-app-icon-512-v9.png`),
  renderAppIcon(1024, `${outputDirectory}/pipeline-app-icon-1024-v9.png`),
  renderAppIcon(512, `${outputDirectory}/pipeline-app-icon-maskable-512-v9.png`),
  renderAppIcon(1024, `${outputDirectory}/pipeline-app-icon-maskable-1024-v9.png`),
]);

async function renderIcon(size, insetRatio, outputPath, backgroundColor = null) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  if (backgroundColor) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, size, size);
  }

  const inset = Math.round(size * insetRatio);
  const dimension = size - inset * 2;
  const markWidth = Math.round(dimension * 0.8);
  const markHeight = Math.round((markWidth * brandMark.height) / brandMark.width);
  const x = Math.round((size - markWidth) / 2);
  const y = Math.round((size - markHeight) / 2 - size * 0.025);
  context.drawImage(brandMark, x, y, markWidth, markHeight);

  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

async function renderFavicon(outputPath) {
  const canvas = createCanvas(32, 32);
  const context = canvas.getContext("2d");
  context.drawImage(brandMark, 3, 1, 26, 28);
  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

async function renderAppIcon(size, outputPath) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const markWidth = Math.round(size * appIconMarkWidthRatio);
  const markHeight = Math.round((markWidth * brandMark.height) / brandMark.width);
  const x = Math.round((size - markWidth) / 2);
  const y = Math.round((size - markHeight) / 2);

  const markCanvas = createCanvas(size, size);
  const markContext = markCanvas.getContext("2d");
  markContext.imageSmoothingEnabled = true;
  markContext.imageSmoothingQuality = "high";
  markContext.drawImage(brandMark, x, y, markWidth, markHeight);
  markContext.globalCompositeOperation = "source-in";

  const markGradient = markContext.createLinearGradient(x, y, x + markWidth, y + markHeight);
  markGradient.addColorStop(0, "#00d98f");
  markGradient.addColorStop(0.46, "#00ad78");
  markGradient.addColorStop(1, "#007b59");
  markContext.fillStyle = markGradient;
  markContext.fillRect(x, y, markWidth, markHeight);

  const { x: opticalX, y: opticalY } = alphaCentroid(markContext, size);
  const offsetX = Math.round((size - 1) / 2 - opticalX);
  const offsetY = Math.round((size - 1) / 2 - opticalY);
  context.drawImage(markCanvas, offsetX, offsetY);

  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

function alphaCentroid(context, size) {
  const pixels = context.getImageData(0, 0, size, size).data;
  let alphaTotal = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = pixels[(y * size + x) * 4 + 3];
      if (alpha === 0) continue;
      alphaTotal += alpha;
      weightedX += x * alpha;
      weightedY += y * alpha;
    }
  }

  if (alphaTotal === 0) return { x: (size - 1) / 2, y: (size - 1) / 2 };
  return { x: weightedX / alphaTotal, y: weightedY / alphaTotal };
}

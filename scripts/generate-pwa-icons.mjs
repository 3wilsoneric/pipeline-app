#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const outputDirectory = "public/pwa";
const brandMarkPath = "public/brand/pipeline-mark.svg";
const appIconSourcePath = "public/brand/pipeline-mark.png";

const brandMark = await loadImage(brandMarkPath);
const appIconSource = await loadImage(appIconSourcePath);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  renderIcon(192, 0.18, `${outputDirectory}/icon-192.png`),
  renderIcon(512, 0.18, `${outputDirectory}/icon-512.png`),
  renderIcon(512, 0.2, `${outputDirectory}/icon-maskable-512.png`, "#ffffff"),
  renderIcon(192, 0.18, `${outputDirectory}/pipeline-icon-192-v2.png`),
  renderIcon(512, 0.18, `${outputDirectory}/pipeline-icon-512-v2.png`),
  renderIcon(512, 0.2, `${outputDirectory}/pipeline-icon-maskable-512-v2.png`, "#ffffff"),
  renderFavicon(`${outputDirectory}/pipeline-favicon-32-v3.png`),
  renderAppIcon(192, `${outputDirectory}/pipeline-app-icon-192-v6.png`),
  renderAppIcon(512, `${outputDirectory}/pipeline-app-icon-512-v6.png`),
  renderAppIcon(1024, `${outputDirectory}/pipeline-app-icon-1024-v6.png`),
  renderAppIcon(512, `${outputDirectory}/pipeline-app-icon-maskable-512-v6.png`),
  renderAppIcon(1024, `${outputDirectory}/pipeline-app-icon-maskable-1024-v6.png`),
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
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(appIconSource, 0, 0, size, size);

  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

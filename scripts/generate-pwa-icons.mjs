#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";

const outputDirectory = "public/pwa";

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  renderIcon(192, 0.17, `${outputDirectory}/icon-192.png`),
  renderIcon(512, 0.17, `${outputDirectory}/icon-512.png`),
  renderIcon(512, 0.27, `${outputDirectory}/icon-maskable-512.png`),
]);

async function renderIcon(size, insetRatio, outputPath) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

  const inset = Math.round(size * insetRatio);
  const dimension = size - inset * 2;
  const radius = Math.round(size * 0.09);
  context.beginPath();
  context.roundRect(inset, inset, dimension, dimension, radius);
  context.fillStyle = "#118c78";
  context.fill();

  context.fillStyle = "#ffffff";
  context.font = `700 ${Math.round(size * 0.45)}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("P", size / 2, size / 2 + size * 0.025);

  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

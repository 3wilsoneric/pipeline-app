#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const outputDirectory = "public/pwa";
const brandMarkPath = "public/brand/pipeline-mark.png";

const brandMark = await loadTransparentBrandMark(brandMarkPath);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  renderIcon(192, 0.18, `${outputDirectory}/icon-192.png`),
  renderIcon(512, 0.18, `${outputDirectory}/icon-512.png`),
  renderIcon(512, 0.2, `${outputDirectory}/icon-maskable-512.png`),
]);

async function renderIcon(size, insetRatio, outputPath) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);

  const inset = Math.round(size * insetRatio);
  const dimension = size - inset * 2;
  const markWidth = Math.round(dimension * 0.8);
  const markHeight = Math.round(dimension * 0.86);
  const x = Math.round((size - markWidth) / 2);
  const y = Math.round((size - markHeight) / 2 - size * 0.025);
  context.drawImage(brandMark, x, y, markWidth, markHeight);

  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

async function loadTransparentBrandMark(sourcePath) {
  const image = await loadImage(sourcePath);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, image.width, image.height);
  let minimumX = image.width;
  let minimumY = image.height;
  let maximumX = 0;
  let maximumY = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const lightestChannel = Math.min(red, green, blue);
    if (lightestChannel > 245) imageData.data[index + 3] = 0;
    if (imageData.data[index + 3] > 0) {
      const pixel = index / 4;
      const x = pixel % image.width;
      const y = Math.floor(pixel / image.width);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  context.putImageData(imageData, 0, 0);

  const width = maximumX - minimumX + 1;
  const height = maximumY - minimumY + 1;
  const cropped = createCanvas(width, height);
  cropped.getContext("2d").drawImage(canvas, minimumX, minimumY, width, height, 0, 0, width, height);
  return cropped;
}

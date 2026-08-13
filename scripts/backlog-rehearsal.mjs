#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const options = parseArgs(process.argv.slice(2));
let state = options.checkpoint ? await loadCheckpoint(options.checkpoint).catch(() => null) : null;
if (!state || options.reset) state = createState(options);
validateState(state, options);

const initialCompletedPages = completedPages(state);
const stopAfter = options.maxSteps ?? Number.POSITIVE_INFINITY;
let steps = 0;
while (!state.complete && steps < stopAfter) {
  runWave(state, options);
  steps += 1;
  if (options.checkpoint && steps % options.checkpointEvery === 0) await saveCheckpoint(options.checkpoint, state);
  if (!options.checkpoint && !state.resume_verified && completedPages(state) >= state.total_pages / 2) {
    state = JSON.parse(JSON.stringify(state));
    state.resume_verified = true;
  }
}
if (options.checkpoint) await saveCheckpoint(options.checkpoint, state);

const processedIds = state.packets.flatMap((packet) => packet.completed_batches);
const duplicateBatchClaims = processedIds.length - new Set(processedIds).size;
const failedPackets = state.packets.filter((packet) => packet.status === "dead_letter").length;
const requiredPagesPerMinute = round(state.total_pages / (options.targetDays * 24 * 60));
const estimatedMinutesAtCapacity = round(state.total_pages / options.capacityPagesPerMinute);
const passed = duplicateBatchClaims === 0
  && failedPackets === 0
  && (state.complete || steps === stopAfter)
  && state.packets.every((packet) => packet.attempts <= options.maxAttempts);

console.log(JSON.stringify({
  ok: passed,
  complete: state.complete,
  rehearsal: {
    packets: state.packet_count,
    pages_per_packet: state.pages_per_packet,
    total_pages: state.total_pages,
    page_batch_size: state.page_batch_size,
    worker_slots: options.workers,
  },
  progress: {
    pages_before_resume: initialCompletedPages,
    pages_completed: completedPages(state),
    packets_completed: state.packets.filter((packet) => packet.status === "complete").length,
    retries: state.retries,
    dead_letters: failedPackets,
    duplicate_batch_claims: duplicateBatchClaims,
    resume_verified: state.resume_verified || Boolean(options.checkpoint && initialCompletedPages > 0),
  },
  planning: {
    target_days: options.targetDays,
    required_pages_per_minute: requiredPagesPerMinute,
    configured_capacity_pages_per_minute: options.capacityPagesPerMinute,
    estimated_minutes_at_configured_capacity: estimatedMinutesAtCapacity,
    capacity_meets_target: options.capacityPagesPerMinute >= requiredPagesPerMinute,
  },
  note: "This validates resumable orchestration, bounded retries, and idempotent page-batch claims. It does not measure OCR provider throughput.",
}, null, 2));
if (!passed) process.exit(1);

function createState(options) {
  const packets = Array.from({ length: options.packets }, (_, index) => ({
    packet_id: `synthetic-packet-${String(index + 1).padStart(3, "0")}`,
    pages: options.pagesPerPacket,
    next_page: 1,
    attempts: 0,
    status: "queued",
    completed_batches: [],
  }));
  return {
    schema_version: 1,
    packet_count: options.packets,
    pages_per_packet: options.pagesPerPacket,
    total_pages: options.packets * options.pagesPerPacket,
    page_batch_size: options.pageBatchSize,
    retries: 0,
    wave: 0,
    complete: false,
    resume_verified: false,
    packets,
  };
}

function runWave(state, options) {
  const candidates = state.packets.filter((packet) => packet.status !== "complete" && packet.status !== "dead_letter").slice(0, options.workers);
  for (const packet of candidates) {
    packet.status = "running";
    const start = packet.next_page;
    const end = Math.min(packet.pages, start + state.page_batch_size - 1);
    const batchId = `${packet.packet_id}:${start}-${end}`;
    if (packet.completed_batches.includes(batchId)) throw new Error("Duplicate page-batch claim detected.");
    packet.attempts += 1;
    if (shouldFailTransiently(packet.packet_id, start, packet.attempts, options.transientFailureModulo)) {
      state.retries += 1;
      packet.status = packet.attempts >= options.maxAttempts ? "dead_letter" : "queued";
      continue;
    }
    packet.completed_batches.push(batchId);
    packet.next_page = end + 1;
    packet.attempts = 0;
    packet.status = packet.next_page > packet.pages ? "complete" : "queued";
  }
  state.wave += 1;
  state.complete = state.packets.every((packet) => packet.status === "complete");
}

function shouldFailTransiently(packetId, start, attempt, modulo) {
  if (attempt > 1 || modulo <= 0) return false;
  return stableHash(`${packetId}:${start}`) % modulo === 0;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function completedPages(state) {
  return state.packets.reduce((total, packet) => total + Math.min(packet.pages, packet.next_page - 1), 0);
}

async function loadCheckpoint(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveCheckpoint(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, path);
}

function validateState(state, options) {
  if (state.schema_version !== 1 || !Array.isArray(state.packets)) throw new Error("Backlog checkpoint schema is invalid.");
  if (state.packet_count !== options.packets || state.pages_per_packet !== options.pagesPerPacket || state.page_batch_size !== options.pageBatchSize) {
    throw new Error("Backlog checkpoint does not match the requested rehearsal dimensions. Use --reset to start over.");
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function parseArgs(args) {
  const result = {
    packets: 20,
    pagesPerPacket: 600,
    pageBatchSize: 25,
    workers: 10,
    maxAttempts: 5,
    transientFailureModulo: 23,
    targetDays: 3,
    capacityPagesPerMinute: 120,
    checkpointEvery: 10,
    checkpoint: null,
    maxSteps: null,
    reset: false,
  };
  const numeric = new Map([
    ["--packets", "packets"], ["--pages", "pagesPerPacket"], ["--batch-size", "pageBatchSize"],
    ["--workers", "workers"], ["--max-attempts", "maxAttempts"], ["--failure-modulo", "transientFailureModulo"],
    ["--target-days", "targetDays"], ["--capacity-pages-per-minute", "capacityPagesPerMinute"],
    ["--checkpoint-every", "checkpointEvery"], ["--max-steps", "maxSteps"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (numeric.has(value)) {
      index += 1;
      result[numeric.get(value)] = Number(args[index]);
    } else if (value === "--checkpoint") {
      index += 1;
      result.checkpoint = args[index];
    } else if (value === "--reset") result.reset = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  for (const [key, value] of Object.entries(result)) {
    if (["checkpoint", "maxSteps", "reset"].includes(key)) continue;
    if (!Number.isFinite(value) || value < 1) throw new Error(`${key} must be a positive number.`);
  }
  if (result.maxSteps !== null && (!Number.isInteger(result.maxSteps) || result.maxSteps < 1)) throw new Error("maxSteps must be a positive integer.");
  return result;
}

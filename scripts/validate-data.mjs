#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const file = path.resolve(rootDir, process.argv[2] ?? "data/benchmark.json");
const data = JSON.parse(await readFile(file, "utf8"));

for (const key of ["dataset", "system", "builds", "models", "results", "commands"]) {
  if (!(key in data)) throw new Error(`missing top-level key: ${key}`);
}

if (!Array.isArray(data.builds)) throw new Error("builds must be an array");
if (!Array.isArray(data.models)) throw new Error("models must be an array");
if (!Array.isArray(data.results)) throw new Error("results must be an array");

const modelIds = new Set(data.models.map((model) => model.id));
const buildIds = new Set(data.builds.map((build) => build.shortLabel));
const resultKeys = new Set();

function resultKey(row) {
  return [row.modelId, row.contextTokens, row.contextLabel, row.build, row.commit ?? "", row.mode, row.depth ?? "", row.b ?? "", row.ub ?? ""].join("|");
}

function assertPublicCommand(command, label) {
  if (typeof command !== "string" || command.length === 0) throw new Error(`${label} command must be a non-empty string`);
  if (command.includes("toolbox run")) throw new Error(`${label} command exposes environment wrapper`);
}

for (const [label, command] of Object.entries(data.commands)) {
  assertPublicCommand(command, `commands.${label}`);
}

for (const row of data.results) {
  if (!modelIds.has(row.modelId)) throw new Error(`unknown model id in result: ${row.modelId}`);
  if (!buildIds.has(row.build)) throw new Error(`unknown build id in result: ${row.build}`);
  if (row.contextTokens != null && (!Number.isInteger(row.contextTokens) || row.contextTokens < 0)) throw new Error(`result has invalid contextTokens: ${JSON.stringify(row)}`);
  if (typeof row.contextLabel !== "string" || row.contextLabel.length === 0) throw new Error(`result has invalid contextLabel: ${JSON.stringify(row)}`);
  if (row.tps != null && typeof row.tps !== "number") throw new Error(`result has non-numeric tps: ${JSON.stringify(row)}`);
  if (row.raw == null) throw new Error(`result is missing raw benchmark row: ${JSON.stringify(row)}`);
  if (row.command != null) assertPublicCommand(row.command, `result ${row.modelId}`);

  const key = resultKey(row);
  if (resultKeys.has(key)) throw new Error(`duplicate result row: ${key}`);
  resultKeys.add(key);
}

console.log(`valid: ${path.relative(rootDir, file)} (${data.results.length} results)`);

#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const args = {
    config: "configs/strix-halo-pp10000.json",
    models: null,
    builds: null,
    runs: null,
    dryRun: false,
    keepExisting: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--models") args.models = new Set(argv[++i].split(",").filter(Boolean));
    else if (arg === "--builds") args.builds = new Set(argv[++i].split(",").filter(Boolean));
    else if (arg === "--runs") args.runs = new Set(argv[++i].split(",").filter(Boolean));
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--keep-existing") args.keepExisting = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-benchmark.mjs [options]

Options:
  --config <file>     Benchmark config JSON (default: configs/strix-halo-pp10000.json)
  --models <ids>      Comma-separated model ids to run
  --builds <ids>      Comma-separated build short labels to run: stock,patched
  --runs <ids>        Comma-separated run ids, e.g. b2048-ub512,b2048-ub2048,b4096-ub2048,b4096-ub4096
  --dry-run           Print commands without running them
  --keep-existing     Preserve existing result rows in output JSON and replace matching rows

Examples:
  node scripts/run-benchmark.mjs --models qwen36-35b-a3b-q8 --runs b2048-ub512,b2048-ub2048,b4096-ub2048,b4096-ub4096
  BENCH_RUNNER_STOCK='env' BENCH_RUNNER_PATCHED='env' node scripts/run-benchmark.mjs --builds patched --runs b4096-ub4096 --dry-run`);
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(rootDir, file), "utf8"));
}

function contextTokens(config) {
  return config.bench.contextTokens ?? config.bench.prompt;
}

function contextLabel(config) {
  return config.bench.contextLabel ?? `pp${contextTokens(config)}`;
}

function benchPrompt(config) {
  return config.bench.prompt ?? contextTokens(config);
}

function makeLlamaBenchCommand(config, modelPath, run) {
  const bench = config.bench;
  const command = [
    "llama-bench",
    "-m", modelPath,
    "-p", String(benchPrompt(config)),
    "-d", String(bench.depths),
    "-n", String(bench.gen),
    "-r", String(bench.repetitions),
    "-ngl", String(bench.ngl),
    "-fa", String(bench.flashAttn),
    "-mmp", String(bench.mmap),
    "-o", String(bench.output ?? "md"),
  ];

  if (run.b != null) command.push("-b", String(run.b));
  if (run.ub != null) command.push("-ub", String(run.ub));

  return command;
}

function runnerEnvName(build) {
  return `BENCH_RUNNER_${build.shortLabel.replaceAll(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

function makeCommand(config, build, model, run) {
  const runner = process.env[runnerEnvName(build)];
  if (!runner) throw new Error(`missing ${runnerEnvName(build)} for build ${build.shortLabel}`);

  return ["bash", "-lc", `${runner} ${commandToString(makeLlamaBenchCommand(config, model.path, run))}`];
}

function publicModelPath(model) {
  return `/path/to/${model.file ?? "model.gguf"}`;
}

function makePublicCommand(config, model, run) {
  return makeLlamaBenchCommand(config, publicModelPath(model), run);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandToString(command) {
  return command.map(shellQuote).join(" ");
}

function rawOutputPath(config, model, build, run) {
  const rawDir = config.output?.rawDir ?? "results/raw";
  const safeModel = model.id.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  const safeContext = contextLabel(config).replaceAll(/[^A-Za-z0-9._-]/g, "_");
  const file = `${safeModel}__${safeContext}__${build.shortLabel}__${run.id}.md`;
  return path.resolve(rootDir, rawDir, config.dataset.id, file);
}

function parseBenchOutput(output, prompt) {
  const lines = output.split(/\r?\n/);
  const testNeedle = `pp${prompt}`;
  const buildLine = lines.find((line) => line.startsWith("build:"));
  const buildMatch = buildLine?.match(/^build:\s+([0-9a-fA-F]+)\s+\(([^)]+)\)/);
  const rows = [];

  for (const line of lines) {
    if (!line.includes("|") || !line.includes(testNeedle)) continue;

    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    const tpsCell = cells.at(-1) ?? "";
    const match = tpsCell.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:±|\+\/-)?\s*([0-9]+(?:\.[0-9]+)?)?/);
    if (!match) continue;

    rows.push({
      tps: Number(match[1]),
      std: match[2] == null ? null : Number(match[2]),
      commit: buildMatch?.[1] ?? null,
      version: buildMatch?.[2] ?? null,
      rawLine: line,
      rawCells: cells,
    });
  }

  if (rows.length === 0) throw new Error(`could not find parseable ${testNeedle} result rows`);
  return rows;
}

async function runCommand(command, outFile) {
  await mkdir(path.dirname(outFile), { recursive: true });

  return await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const chunks = [];

    const onData = (data, stream) => {
      const text = data.toString();
      output += text;
      chunks.push(text);
      stream.write(text);
    };

    child.stdout.on("data", (data) => onData(data, process.stdout));
    child.stderr.on("data", (data) => onData(data, process.stderr));
    child.on("error", reject);
    child.on("close", async (code) => {
      await writeFile(outFile, chunks.join(""));
      if (code !== 0) {
        reject(new Error(`command failed with exit code ${code}: ${commandToString(command)}`));
        return;
      }
      resolve(output);
    });
  });
}

function filterItems(items, allowed, key) {
  if (!allowed) return items;
  return items.filter((item) => allowed.has(item[key]));
}

function publicModel(model) {
  const { path: _path, ...rest } = model;
  return rest;
}

function resultKey(row) {
  return [row.modelId, row.contextTokens, row.contextLabel, row.build, row.mode, row.depth ?? row.raw?.line ?? "", row.b ?? "", row.ub ?? ""].join("|");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(args.config);

  const models = filterItems(config.models, args.models, "id");
  const builds = filterItems(config.builds, args.builds, "shortLabel");
  const runs = filterItems(config.runs, args.runs, "id");

  if (models.length === 0) throw new Error("no models selected");
  if (builds.length === 0) throw new Error("no builds selected");
  if (runs.length === 0) throw new Error("no runs selected");

  const results = [];

  for (const model of models) {
    for (const build of builds) {
      for (const run of runs) {
        const command = makeCommand(config, build, model, run);
        const commandText = commandToString(command);
        const publicCommandText = commandToString(makePublicCommand(config, model, run));
        const outFile = rawOutputPath(config, model, build, run);

        console.log(`\n## ${model.id} / ${build.shortLabel} / ${run.id}`);
        console.log(commandText);

        if (args.dryRun) continue;

        const output = await runCommand(command, outFile);
        const parsedRows = parseBenchOutput(output, benchPrompt(config));

        for (const parsed of parsedRows) {
          results.push({
            modelId: model.id,
            build: build.shortLabel,
            mode: run.mode,
            b: run.b ?? null,
            ub: run.ub ?? null,
            contextTokens: contextTokens(config),
            contextLabel: contextLabel(config),
            tps: parsed.tps,
            std: parsed.std,
            command: publicCommandText,
            rawOutput: path.relative(rootDir, outFile),
            measuredCommit: parsed.commit,
            measuredVersion: parsed.version,
            raw: {
              line: parsed.rawLine,
              cells: parsed.rawCells,
            },
          });
        }
      }
    }
  }

  if (args.dryRun) return;

  const outputJson = path.resolve(rootDir, config.output?.json ?? "data/benchmark.json");
  let finalResults = results;
  if (args.keepExisting) {
    const existing = await readJson(path.relative(rootDir, outputJson));
    const byKey = new Map(existing.results.map((row) => [resultKey(row), row]));
    for (const row of results) byKey.set(resultKey(row), row);
    finalResults = [...byKey.values()];
  }

  const benchmark = {
    dataset: config.dataset,
    system: config.system,
    builds: config.builds.map(({ patched: _patched, ...build }) => build),
    commands: {
      default: commandToString(makePublicCommand(config, { file: "model.gguf" }, { id: "default", mode: "default" })),
      patched: commandToString(makePublicCommand(config, { file: "model.gguf" }, { id: "default", mode: "default" })),
    },
    models: config.models.map(publicModel),
    results: finalResults,
  };

  await mkdir(path.dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(benchmark, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(rootDir, outputJson)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

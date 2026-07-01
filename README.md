# llama.cpp backend benchmarks

Public benchmark notes and GitHub Pages site for comparing `llama.cpp` backends on AMD Strix Halo / RDNA3.5.

The published page is static and reproducible from the files in this repository.

## What is measured

- Prefill throughput with `llama-bench`.
- Context depth is swept per measurement across `512`, `10000`, `25000`, `50000`, `75000`, and `100000` tokens.
- Batch sweep performance with explicit valid `-b` and `-ub` pairs.
- Each backend is versioned, for example `ROCm 7.2.4` and `ROCm 7.2.4 patched`.

## Default command

```bash
llama-bench \
  -m /path/to/model.gguf \
  -p 2080 \
  -d 512,10000,25000,50000,75000,100000 \
  -b 2048 \
  -ub 512 \
  -n 0 \
  -r 3 \
  -ngl 999 \
  -fa on \
  -mmp 0 \
  -o jsonl
```

## Batch sweep command

The JavaScript runner can print or execute commands from the JSON config when external runner prefixes are provided.

```bash
npm run bench -- \
  --config configs/strix-halo-pp10000.json \
  --models qwen36-35b-a3b-q8 \
  --runs b2048-ub512,b2048-ub2048,b4096-ub2048,b4096-ub4096
```

Dry-run commands without executing them:

```bash
npm run bench -- --dry-run --models qwen36-35b-a3b-q8 --runs b2048-ub512,b2048-ub2048,b4096-ub2048,b4096-ub4096
```

Append/replace matching rows in `data/benchmark.json` instead of replacing all selected results:

```bash
npm run bench -- --keep-existing --models qwen36-35b-a3b-q8 --runs b2048-ub512,b2048-ub2048,b4096-ub2048,b4096-ub4096
```

## Local llama.cpp Benchmark

For reproducible runs from any `llama.cpp` environment, run the local runner inside the environment. It records `llama.cpp` version, detected backend/device, OS and kernel automatically.

Run through any external environment wrapper by setting per-build runner prefixes:

```bash
BENCH_RUNNER_STOCK='env' BENCH_RUNNER_PATCHED='env' \
  npm run bench -- --builds stock,patched --models qwen36-35b-a3b-q8
```

Or use the Bash script directly inside the selected environment, so the benchmark environment does not need Node/npm. It measures `2080` prompt tokens while sweeping selected depths from `512` to `100000`:

```bash
bash scripts/bench-local.sh /path/to/model.gguf
```

The benchmark protocol is fixed inside `scripts/bench-local.sh`:

- prompt tokens: `2080`
- depth sweep in one command: `512`, `10000`, `25000`, `50000`, `75000`, `100000`
- batch/ubatch pairs: `2048/512` default, `2048/2048`, `4096/2048`, `4096/4096`
- skipped pairs: any `batch < ubatch`
- generated tokens: `0`
- repetitions: `3`
- GPU layers: `999`
- flash attention: `on`
- mmap: `off`
- output: `jsonl`
- runs: `b2048-ub512`, `b2048-ub2048`, `b4096-ub2048`, `b4096-ub4096`

The reduced sweep uses the listed valid `batch/ubatch` pairs. Output is displayed live and `data/benchmark.json` is updated as each JSONL result object is printed. Each saved result keeps the parsed summary fields and the full raw `llama-bench` row.

If `llama-bench` is not on `PATH`, set the binary locations before running:

```bash
LLAMA_BENCH=/path/to/llama-bench LLAMA_CLI=/path/to/llama-cli \
  bash scripts/bench-local.sh /path/to/model.gguf
```

If you are running from a normal dev shell with npm available, this equivalent shortcut is also available:

```bash
npm run bench:local -- /path/to/model.gguf
```

Results are written under `results/local-bench/<timestamp>/` with raw JSONL output, logs, `metadata.txt`, and `summary.csv`.

Preview the GitHub Pages site locally:

```bash
npm run serve
```

## GitHub Pages

Enable Pages with source set to the repository root. The page entrypoint is `index.html`.

## Data

- `data/benchmark.json`: canonical data consumed by the static page.
- `configs/strix-halo-pp10000.json`: JSON config used by the JS benchmark runner.

#!/usr/bin/env python3
import argparse
import json
import os
import re
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def slug(value):
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value).lower()).strip("-")
    return value or "unknown"


def context_label(tokens):
    if tokens == 0:
        return "0"
    if tokens % 1000 == 0:
        return f"{tokens // 1000}k"
    return str(tokens)


def number(value):
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() else parsed


def first(row, names):
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
    return None


def compact(mapping):
    return {key: value for key, value in mapping.items() if value not in (None, "")}


def result_key(row):
    return "|".join(str(part) for part in [
        row.get("modelId"),
        row.get("contextTokens"),
        row.get("contextLabel"),
        row.get("build"),
        row.get("commit") or "",
        row.get("mode"),
        row.get("depth") or "",
        row.get("b") or "",
        row.get("ub") or "",
    ])


def same_combo(row, *, model_id, build_id, commit, mode, batch, ubatch):
    return (
        row.get("modelId") == model_id
        and row.get("build") == build_id
        and (row.get("commit") in (None, commit) or commit is None)
        and row.get("mode") == mode
        and (batch is None or row.get("b") == batch)
        and (ubatch is None or row.get("ub") == ubatch)
    )


parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--model", required=True)
parser.add_argument("--json", default=str(ROOT / "data/benchmark.json"))
args = parser.parse_args()

with open(args.input, encoding="utf-8") as handle:
    text = handle.read().strip()

try:
    parsed = json.loads(text)
except json.JSONDecodeError as exc:
    parsed = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            parsed.append(json.loads(line))
        except json.JSONDecodeError as line_exc:
            raise SystemExit(f"cannot parse JSONL benchmark output {args.input}:{line_no}: {line_exc}") from exc

rows = parsed if isinstance(parsed, list) else [parsed]
prompt_set = os.environ.get("BENCH_PROMPT_SET", "")

bench_rows = []
for row in rows:
    prompt = number(row.get("n_prompt"))
    tps = number(row.get("avg_ts"))
    bench_rows.append({
        "raw": row,
        "contextTokens": int(prompt) if prompt is not None else None,
        "contextLabel": "default" if prompt_set == "default" else context_label(int(prompt)) if prompt is not None else "unknown",
        "depth": number(first(row, ["n_depth", "depth", "n_ctx", "n_kv"])),
        "tps": float(tps) if tps is not None else None,
        "std": number(row.get("stddev_ts")),
        "b": number(row.get("n_batch")),
        "ub": number(row.get("n_ubatch")),
        "build_commit": row.get("build_commit"),
        "build_number": row.get("build_number"),
        "cpu_info": row.get("cpu_info"),
        "gpu_info": row.get("gpu_info"),
        "backends": row.get("backends"),
        "model_type": row.get("model_type"),
        "model_size": row.get("model_size"),
        "model_n_params": row.get("model_n_params"),
    })

if not bench_rows:
    print(f"no benchmark rows in {args.input}; leaving benchmark JSON unchanged")
    raise SystemExit(0)

model_path = Path(args.model)
model_file = model_path.name
model_id = slug(re.sub(r"\.gguf$", "", model_file, flags=re.I))
detected_backend = bench_rows[0].get("backends") or os.environ.get("BENCH_BACKEND", "unknown")
backend = os.environ.get("BENCH_BACKEND_NAME") or detected_backend
backend_version = os.environ.get("BENCH_BACKEND_VERSION") or None
backend_variant = os.environ.get("BENCH_BACKEND_VARIANT") or None
backend_label = os.environ.get("BENCH_BACKEND_LABEL") or " ".join(part for part in [backend, backend_version, backend_variant] if part) or backend
version_text = os.environ.get("BENCH_LLAMA_VERSION", "")
commit = bench_rows[0].get("build_commit")
if not commit:
    commit_match = re.search(r"\(([0-9a-fA-F]{7,40})\)", version_text) or re.search(r"\b([0-9a-fA-F]{7,40})\b", version_text)
    commit = commit_match.group(1) if commit_match else None
version = bench_rows[0].get("build_number")
if version is None:
    version_match = re.search(r"version:\s*([^\s]+)", version_text, re.I)
    version = version_match.group(1) if version_match else None
build_id = slug("-".join(part for part in [backend_label, commit[:9] if commit else version or "local"] if part))
command = os.environ.get("BENCH_COMMAND", "")
mode = os.environ.get("BENCH_MODE", "default")
batch = number(os.environ.get("BENCH_BATCH"))
ubatch = number(os.environ.get("BENCH_UBATCH"))
output_json = Path(args.json)

if output_json.exists():
    data = json.loads(output_json.read_text(encoding="utf-8"))
else:
    data = {
        "dataset": {"id": "local-live", "date": date.today().isoformat(), "rawCsv": "results/local-bench"},
        "system": {
            "cpuGpu": "Unknown",
            "gpu": "Unknown",
            "arch": os.environ.get("BENCH_OS", "Unknown"),
            "memory": f"kernel {os.environ.get('BENCH_KERNEL', 'unknown')}",
            "waveSize": "Unknown",
        },
        "builds": [],
        "models": [],
        "results": [],
        "commands": {},
    }

data["dataset"]["date"] = date.today().isoformat()
data["system"]["arch"] = os.environ.get("BENCH_OS", data["system"].get("arch", "Unknown"))
data["system"]["memory"] = f"kernel {os.environ.get('BENCH_KERNEL', 'unknown')}"
data["system"]["cpuGpu"] = bench_rows[0].get("cpu_info") or data["system"].get("cpuGpu", "Unknown")
data["system"]["gpu"] = bench_rows[0].get("gpu_info") or data["system"].get("gpu", "Unknown")

build_record = compact({
    "shortLabel": build_id,
    "label": backend_label,
    "backend": backend,
    "detectedBackend": detected_backend,
    "backendVersion": backend_version,
    "variant": backend_variant,
    "backendLabel": backend_label,
    "version": str(version) if version is not None else None,
    "commit": commit,
    "llamaVersion": version_text,
})
for index, build in enumerate(data["builds"]):
    if build.get("shortLabel") == build_id:
        data["builds"][index] = {**build, **build_record}
        break
else:
    data["builds"].append(build_record)

if not any(model.get("id") == model_id for model in data["models"]):
    quant_match = re.search(r"Q[0-9A-Z_]+", model_file, re.I)
    data["models"].append({
        "id": model_id,
        "family": re.split(r"[.-]", model_file)[0] or model_file,
        "name": model_file,
        "file": model_file,
        "architecture": bench_rows[0].get("model_type") or "unknown",
        "quant": quant_match.group(0) if quant_match else "unknown",
        "quantProvider": "local",
        "shape": str(bench_rows[0].get("model_n_params") or "unknown"),
    })

data["commands"][os.environ.get("BENCH_RUN_ID", mode)] = command

new_results = []
for row in bench_rows:
    row_commit = row.get("build_commit") or commit
    row_version = row.get("build_number") if row.get("build_number") is not None else version
    new_results.append({
        "modelId": model_id,
        "contextTokens": row["contextTokens"],
        "contextLabel": row["contextLabel"],
        "build": build_id,
        "version": str(row_version) if row_version is not None else None,
        "commit": row_commit,
        "mode": mode,
        "depth": row.get("depth"),
        "b": row.get("b"),
        "ub": row.get("ub"),
        "tps": row["tps"],
        "std": row["std"],
        "command": command,
        "raw": row.get("raw"),
    })

combo_commit = new_results[0].get("commit") if new_results else commit
kept_results = [row for row in data["results"] if not same_combo(
    row,
    model_id=model_id,
    build_id=build_id,
    commit=combo_commit,
    mode=mode,
    batch=batch,
    ubatch=ubatch,
)]
existing = {result_key(row): row for row in kept_results}
for result in new_results:
    existing[result_key(result)] = result

data["results"] = sorted(existing.values(), key=lambda row: (row.get("modelId", ""), row.get("contextTokens", 0), row.get("build", "")))
output_json.parent.mkdir(parents=True, exist_ok=True)
output_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
try:
    display_path = output_json.relative_to(ROOT)
except ValueError:
    display_path = output_json
print(f"updated {display_path} (+{len(bench_rows)} row{'s' if len(bench_rows) != 1 else ''})")

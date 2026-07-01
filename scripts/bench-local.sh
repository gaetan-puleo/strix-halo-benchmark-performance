#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_ROOT="${REPO_ROOT}/results/local-bench"

# Benchmark configuration. Edit here when changing the benchmark protocol.
LLAMA_BENCH="${LLAMA_BENCH:-llama-bench}"
LLAMA_CLI="${LLAMA_CLI:-llama-cli}"
PROMPT_TOKENS_DEFAULT="2080"
DEPTHS_DEFAULT="512,10000,25000,50000,75000,100000"
DEPTHS="${DEPTHS:-$DEPTHS_DEFAULT}"
BATCH_SIZES="${BATCH_SIZES:-2048,4096}"
UBATCH_SIZES="${UBATCH_SIZES:-2048,4096}"
GEN_TOKENS="0"
REPETITIONS="3"
GPU_LAYERS="999"
FLASH_ATTN="on"
MMAP="0"
OUTPUT="jsonl"
EXTRA_ARGS=""
BENCH_BACKEND_NAME="${BENCH_BACKEND_NAME:-}"
BENCH_BACKEND_VERSION="${BENCH_BACKEND_VERSION:-}"
BENCH_BACKEND_VARIANT="${BENCH_BACKEND_VARIANT:-}"
BENCH_BACKEND_LABEL="${BENCH_BACKEND_LABEL:-}"

# Avoid batch < ubatch while keeping the selected sweep compact.
BENCH_RUNS=(
  "b2048-ub512:2048:512"
  "b2048-ub2048:2048:2048"
  "b4096-ub2048:4096:2048"
  "b4096-ub4096:4096:4096"
)

MODEL="${1:-}"
OUT_DIR="${OUT_ROOT}/$(date +%Y%m%d-%H%M%S)"

usage() {
  cat <<'EOF'
Usage:
  scripts/bench-local.sh /path/to/model.gguf

This runner is meant to be launched from inside any llama.cpp environment. It
records llama.cpp version, detected backend/device, OS, and kernel automatically.

Fixed benchmark protocol:
  prompt tokens: 2080
  depths: 512,10000,25000,50000,75000,100000
  batch sizes: 2048,4096
  ubatch sizes: 512,2048,4096
  skipped pairs: batch < ubatch
  generated tokens: 0
  repetitions: 3
  GPU layers: 999
  flash attention: on
  mmap: off
  output: jsonl
  runs: b2048-ub512, b2048-ub2048, b4096-ub2048, b4096-ub4096

Override binaries only if they are not on PATH:
  LLAMA_BENCH=/path/to/llama-bench LLAMA_CLI=/path/to/llama-cli scripts/bench-local.sh /path/to/model.gguf

Name the backend explicitly when comparing several implementations:
  BENCH_BACKEND_LABEL="ROCm 7.2.4" scripts/bench-local.sh /path/to/model.gguf
  BENCH_BACKEND_LABEL="ROCm 7.2.4 patched" scripts/bench-local.sh /path/to/model.gguf
  BENCH_BACKEND_LABEL="Vulkan RADV Mesa 25.2" scripts/bench-local.sh /path/to/model.gguf
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

split_csv_into_array() {
  local value="$1"
  local -n out="$2"
  local item
  IFS=',' read -ra parts <<< "$value"
  for item in "${parts[@]}"; do
    item="${item#${item%%[![:space:]]*}}"
    item="${item%${item##*[![:space:]]}}"
    [[ -n "$item" ]] && out+=("$item")
  done
}

if [[ "$MODEL" == "-h" || "$MODEL" == "--help" ]]; then
  usage
  exit 0
fi

[[ $# -eq 1 ]] || die "expected exactly one model argument: /path/to/model.gguf"
[[ -n "$MODEL" ]] || die "missing model path"
[[ -e "$MODEL" ]] || die "model not found: $MODEL"
command -v "$LLAMA_BENCH" >/dev/null 2>&1 || die "llama-bench not found: $LLAMA_BENCH"

PROMPT_SETS=("p2080-d512-100000:${PROMPT_TOKENS_DEFAULT}")

mkdir -p "$OUT_DIR"

sanitize() {
  basename "$1" | tr -c 'A-Za-z0-9._-' '_'
}

csv_escape() {
  local value="$1"
  value="${value//\"/\"\"}"
  printf '"%s"' "$value"
}

detect_os() {
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    printf '%s' "${PRETTY_NAME:-${NAME:-unknown}}"
  else
    uname -s
  fi
}

detect_llama_version() {
  if command -v "$LLAMA_CLI" >/dev/null 2>&1; then
    "$LLAMA_CLI" --version 2>&1 | tr '\n' ' ' | sed 's/[[:space:]]*$//'
  else
    "$LLAMA_BENCH" --version 2>&1 | tr '\n' ' ' | sed 's/[[:space:]]*$//'
  fi
}

detect_devices() {
  if command -v "$LLAMA_CLI" >/dev/null 2>&1; then
    "$LLAMA_CLI" --list-devices 2>&1 | sed 's/[[:space:]]*$//'
  else
    "$LLAMA_BENCH" --list-devices 2>&1 | sed 's/[[:space:]]*$//'
  fi
}

detect_backend() {
  local devices="$1"
  if grep -qi 'ROCm' <<< "$devices"; then
    printf 'rocm'
  elif grep -qi 'Vulkan' <<< "$devices"; then
    printf 'vulkan'
  elif grep -qi 'CUDA' <<< "$devices"; then
    printf 'cuda'
  elif grep -qi 'Metal' <<< "$devices"; then
    printf 'metal'
  else
    printf 'unknown'
  fi
}

pretty_backend_name() {
  case "$1" in
    rocm) printf 'ROCm' ;;
    vulkan) printf 'Vulkan' ;;
    cuda) printf 'CUDA' ;;
    metal) printf 'Metal' ;;
    *) printf '%s' "$1" ;;
  esac
}

make_backend_label() {
  local name="$1" version="$2" variant="$3"
  local label="$name"
  [[ -n "$version" ]] && label+=" ${version}"
  [[ -n "$variant" ]] && label+=" ${variant}"
  printf '%s' "$label"
}

OS_NAME="$(detect_os)"
KERNEL="$(uname -r)"
LLAMA_VERSION="$(detect_llama_version || true)"
DEVICES="$(detect_devices || true)"
BACKEND="$(detect_backend "$DEVICES")"
BACKEND_NAME="${BENCH_BACKEND_NAME:-$(pretty_backend_name "$BACKEND")}"
BACKEND_VERSION="${BENCH_BACKEND_VERSION:-}"
BACKEND_VARIANT="${BENCH_BACKEND_VARIANT:-}"
BACKEND_LABEL="${BENCH_BACKEND_LABEL:-$(make_backend_label "$BACKEND_NAME" "$BACKEND_VERSION" "$BACKEND_VARIANT")}"

cat > "${OUT_DIR}/metadata.txt" <<EOF
created=$(date -Is)
os=${OS_NAME}
kernel=${KERNEL}
backend=${BACKEND}
backend_name=${BACKEND_NAME}
backend_version=${BACKEND_VERSION}
backend_variant=${BACKEND_VARIANT}
backend_label=${BACKEND_LABEL}
llama_version=${LLAMA_VERSION}
llama_bench=$(command -v "$LLAMA_BENCH")
llama_cli=$(command -v "$LLAMA_CLI" 2>/dev/null || true)

devices:
${DEVICES}
EOF

summary_csv="${OUT_DIR}/summary.csv"
printf 'timestamp,model,run,batch_size,ubatch_size,backend,backend_label,os,kernel,llama_version,pp,tg,repetitions,gpu_layers,flash_attn,mmap,status,output,log\n' > "$summary_csv"

run_model() {
  local model="$1"
  local model_name run_spec run_id batch_size ubatch_size prompt_spec prompt_id prompt_tokens prompt_display prefix output_file log_file status command_text mode
  [[ -e "$model" ]] || die "model not found: $model"

  model_name="$(sanitize "$model")"

  for run_spec in "${BENCH_RUNS[@]}"; do
    IFS=':' read -r run_id batch_size ubatch_size <<< "$run_spec"
    mode="default"
    if [[ "$run_id" != "default" && "$run_id" != "b2048-ub512" ]]; then
      mode="custom"
    fi

    for prompt_spec in "${PROMPT_SETS[@]}"; do
      IFS=':' read -r prompt_id prompt_tokens <<< "$prompt_spec"
      prompt_display="$prompt_id"
      if [[ -n "$prompt_tokens" ]]; then
        prompt_display="$prompt_tokens"
      fi

      prefix="${model_name}-${run_id}-${prompt_id}-$(date +%Y%m%d-%H%M%S)"
      output_file="${OUT_DIR}/${prefix}.${OUTPUT}"
      log_file="${OUT_DIR}/${prefix}.log"
      status="ok"

      local bench_args=(
        "$LLAMA_BENCH"
        -m "$model"
        -o "$OUTPUT"
        -n "$GEN_TOKENS"
        -r "$REPETITIONS"
        -ngl "$GPU_LAYERS"
        -fa "$FLASH_ATTN"
        -mmp "$MMAP"
      )

      if [[ -n "$prompt_tokens" ]]; then
        bench_args+=(-p "$prompt_tokens")
      fi

      if [[ -n "$DEPTHS" ]]; then
        bench_args+=(-d "$DEPTHS")
      fi
      if [[ -n "$batch_size" ]]; then
        bench_args+=(-b "$batch_size")
      fi
      if [[ -n "$ubatch_size" ]]; then
        bench_args+=(-ub "$ubatch_size")
      fi

      local extra_array=()
      if [[ -n "$EXTRA_ARGS" ]]; then
        read -r -a extra_array <<< "$EXTRA_ARGS"
        bench_args+=("${extra_array[@]}")
      fi

      command_text="$(printf '%q ' "${bench_args[@]}")"
      {
        printf 'timestamp=%s\n' "$(date -Is)"
        printf 'model=%s\n' "$model"
        printf 'run=%s\n' "$run_id"
        printf 'prompt_set=%s\n' "$prompt_id"
        printf 'prompt_tokens=%s\n' "$prompt_tokens"
        printf 'depths=%s\n' "$DEPTHS"
        printf 'batch_size=%s\n' "$batch_size"
        printf 'ubatch_size=%s\n' "$ubatch_size"
        printf 'backend=%s\n' "$BACKEND"
        printf 'os=%s\n' "$OS_NAME"
        printf 'kernel=%s\n' "$KERNEL"
        printf 'llama_version=%s\n' "$LLAMA_VERSION"
        printf 'command=%s\n\n' "$command_text"
      } > "$log_file"

      echo "==> ${BACKEND_LABEL}: ${model} ${run_id} pp${prompt_display}"
      : > "$output_file"
      set +e
      "${bench_args[@]}" 2> >(tee -a "$log_file" >&2) | while IFS= read -r bench_line; do
        printf '%s\n' "$bench_line"
        printf '%s\n' "$bench_line" >> "$output_file"
        if [[ "$bench_line" == \{* ]]; then
          BENCH_BACKEND="$BACKEND" \
          BENCH_BACKEND_NAME="$BACKEND_NAME" \
          BENCH_BACKEND_VERSION="$BACKEND_VERSION" \
          BENCH_BACKEND_VARIANT="$BACKEND_VARIANT" \
          BENCH_BACKEND_LABEL="$BACKEND_LABEL" \
          BENCH_OS="$OS_NAME" \
          BENCH_KERNEL="$KERNEL" \
          BENCH_LLAMA_VERSION="$LLAMA_VERSION" \
          BENCH_COMMAND="$command_text" \
          BENCH_RUN_ID="$run_id" \
          BENCH_MODE="$mode" \
          BENCH_BATCH="$batch_size" \
          BENCH_UBATCH="$ubatch_size" \
          BENCH_PROMPT_SET="$prompt_id" \
            python3 "${SCRIPT_DIR}/append-local-bench.py" --input "$output_file" --model "$model"
        fi
      done
      status_code=${PIPESTATUS[0]}
      set -e

      if [[ "$status_code" -ne 0 ]]; then
        status="failed"
        echo "failed: see $log_file" >&2
      fi

      {
        csv_escape "$(date -Is)"; printf ','
        csv_escape "$model"; printf ','
        csv_escape "$run_id"; printf ','
        csv_escape "$batch_size"; printf ','
        csv_escape "$ubatch_size"; printf ','
        csv_escape "$BACKEND"; printf ','
        csv_escape "$BACKEND_LABEL"; printf ','
        csv_escape "$OS_NAME"; printf ','
        csv_escape "$KERNEL"; printf ','
        csv_escape "$LLAMA_VERSION"; printf ','
        csv_escape "$prompt_display"; printf ','
        csv_escape "$GEN_TOKENS"; printf ','
        csv_escape "$REPETITIONS"; printf ','
        csv_escape "$GPU_LAYERS"; printf ','
        csv_escape "$FLASH_ATTN"; printf ','
        csv_escape "$MMAP"; printf ','
        csv_escape "$status"; printf ','
        csv_escape "$output_file"; printf ','
        csv_escape "$log_file"; printf '\n'
      } >> "$summary_csv"
    done
  done
}

run_model "$MODEL"

echo "results: $OUT_DIR"
echo "summary: $summary_csv"

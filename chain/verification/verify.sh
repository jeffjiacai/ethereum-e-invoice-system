#!/usr/bin/env bash
#
# Machine-checked verification of the EInvoice lifecycle invariants using the
# Solidity SMTChecker (CHC engine). Proves the paper's Lemma 1 and Theorems 1,
# 2, and 4 over ALL reachable transaction sequences (an unbounded inductive
# proof), not just the bounded cases exercised by the Hardhat test suite.
#
# Requirements:
#   * The solc 0.8.24 binary (downloaded automatically by `npx hardhat compile`).
#   * A z3 4.12 shared library. Easiest: `pip install z3-solver==4.12.6.0`.
#     solc 0.8.24 dlopens `libz3.so.4.12`; this script symlinks whatever z3 it
#     finds to that soname in a temp dir on LD_LIBRARY_PATH.
#
# Usage:  bash verification/verify.sh    (run from the chain/ directory or repo root)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="$HERE/EInvoiceModel.sol"

# --- locate the solc 0.8.24 binary from the Hardhat compiler cache ---
SOLC="$(ls "$HOME"/.cache/hardhat-nodejs/compilers-v2/linux-amd64/solc-linux-amd64-v0.8.24* 2>/dev/null | head -1 || true)"
if [[ -z "${SOLC}" || ! -x "${SOLC}" ]]; then
  echo "solc 0.8.24 not found in the Hardhat cache."
  echo "Run 'npx hardhat compile' in chain/ once to download it, then re-run this script."
  exit 1
fi

# --- locate a z3 4.12 shared library ---
LIBZ3="$(python3 -c "import z3,os;print(os.path.join(os.path.dirname(z3.__file__),'lib','libz3.so'))" 2>/dev/null || true)"
if [[ -z "${LIBZ3}" || ! -f "${LIBZ3}" ]]; then
  LIBZ3="$(ldconfig -p 2>/dev/null | awk '/libz3\.so/{print $NF; exit}')"
fi
if [[ -z "${LIBZ3}" || ! -f "${LIBZ3}" ]]; then
  echo "libz3 not found. Install it with:  pip install z3-solver==4.12.6.0"
  exit 1
fi

# --- present it under the soname solc expects ---
SHIM="$(mktemp -d)"
trap 'rm -rf "${SHIM}"' EXIT
ln -sf "${LIBZ3}" "${SHIM}/libz3.so.4.12"

echo "solc : ${SOLC}"
echo "z3   : ${LIBZ3}"
echo "model: ${MODEL}"
echo "------------------------------------------------------------"

LD_LIBRARY_PATH="${SHIM}:${LD_LIBRARY_PATH:-}" "${SOLC}" \
  --model-checker-engine chc \
  --model-checker-targets assert \
  --model-checker-timeout 120000 \
  "${MODEL}"

echo "------------------------------------------------------------"
echo "Done. 'proved safe' with no counterexamples means every invariant holds"
echo "for all transaction sequences and all invoice numbers."

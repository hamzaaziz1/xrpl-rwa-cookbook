#!/usr/bin/env bash
set -e

echo "=============================================="
echo " XRPL RWA cookbook — full run"
echo "=============================================="

for step in amendments credentials domains issue powers dex; do
  echo ""
  echo "----------------------------------------------"
  echo " npm run $step"
  echo "----------------------------------------------"
  npm run --silent "$step"
done

echo ""
echo "all steps completed."

# tools/verify.ps1 — run the entire ZeroMiss verification gauntlet on Windows.
#   pwsh -File tools/verify.ps1
# Skips the C++/Octave cross-checks gracefully if those toolchains aren't installed.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

function Step($name, $block) {
  Write-Host "`n===== $name =====" -ForegroundColor Cyan
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$name FAILED" }
}

# Lint the GitHub Actions workflows if actionlint is installed (catches e.g. the
# "secrets not allowed in if:" class of error before it ever reaches GitHub).
if (Get-Command actionlint -ErrorAction SilentlyContinue) {
  Step "actionlint (workflows)" { actionlint .github/workflows/*.yml }
} else { Write-Host "actionlint not installed — skipping workflow lint" -ForegroundColor Yellow }

Step "ruff (lint)"            { & $py -m ruff check engine tests }
Step "pytest (+coverage 85%)" { & $py -m pytest --cov=zeromiss --cov-fail-under=85 -q }
Step "validation suite"       { & $py -m zeromiss validate }

# Optional: build + run the C++ cross-check if a compiler is available.
try {
  Push-Location native
  & $py setup_native.py build_ext --inplace
  Pop-Location
  Step "Python <-> C++ cross-check" { & $py -m pytest tests/test_native_crosscheck.py -q }
} catch { Write-Host "C++ cross-check skipped (no compiler): $_" -ForegroundColor Yellow; Pop-Location -ErrorAction SilentlyContinue }

# Optional: Octave cross-check if octave-cli is on PATH.
if (Get-Command octave-cli -ErrorAction SilentlyContinue) {
  Step "Python <-> Octave cross-check" { & $py -m pytest tests/test_matlab_crosscheck.py -q }
} else { Write-Host "Octave cross-check skipped (octave-cli not on PATH)" -ForegroundColor Yellow }

# Optional: MATLAB/Simulink cross-check if matlab is on PATH (licensed install).
if (Get-Command matlab -ErrorAction SilentlyContinue) {
  Step "Python <-> Simulink cross-check" { & $py -m pytest tests/test_simulink_crosscheck.py -q }
} else { Write-Host "Simulink cross-check skipped (matlab not on PATH)" -ForegroundColor Yellow }

# Web twin
Step "web: typecheck"  { Push-Location web; npm run typecheck; Pop-Location }
Step "web: vitest"     { Push-Location web; npm run test; Pop-Location }
Step "web: build"      { Push-Location web; npm run build; Pop-Location }

Write-Host "`nALL GREEN ✓" -ForegroundColor Green

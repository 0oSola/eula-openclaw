$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"

& semble savings --verbose
exit $LASTEXITCODE

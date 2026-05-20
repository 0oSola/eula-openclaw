param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Query,

  [Parameter(Position = 1)]
  [string] $Path = ".",

  [int] $TopK = 5,

  [ValidateSet("hybrid", "semantic", "bm25")]
  [string] $Mode = "hybrid",

  [switch] $IncludeTextFiles
)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"

$sembleArgs = @("search", "-k", [string]$TopK, "-m", $Mode)
if ($IncludeTextFiles) {
  $sembleArgs += "--include-text-files"
}
$sembleArgs += @($Query, $Path)

& semble @sembleArgs
exit $LASTEXITCODE

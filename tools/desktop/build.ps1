# Builds RhapsodDashboard.exe with the C# compiler that ships with
# .NET Framework 4 (present on every supported Windows), so no SDK is needed.
#
#   powershell -ExecutionPolicy Bypass -File tools\desktop\build.ps1
#
# Output: tools\desktop\bin\RhapsodDashboard.exe
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
  throw 'csc.exe from .NET Framework 4 was not found.'
}
$out = Join-Path $here 'bin'
New-Item -ItemType Directory -Force -Path $out | Out-Null
& $csc /nologo /target:exe /optimize+ /warnaserror+ `
  /reference:System.Windows.Forms.dll `
  "/out:$(Join-Path $out 'RhapsodDashboard.exe')" `
  (Join-Path $here 'RhapsodDashboard.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Host "Built $(Join-Path $out 'RhapsodDashboard.exe')"

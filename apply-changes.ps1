# Sample upload for the disposable practice folder in README.md.
param (
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $ProjectPath).ProviderPath
$File = Join-Path $Root 'bridge-test.txt'

# CreateNew fails if the file already exists.
$Stream = [System.IO.File]::Open($File, [System.IO.FileMode]::CreateNew)
try {
    $Bytes = [System.Text.Encoding]::UTF8.GetBytes('Bridge works!')
    $Stream.Write($Bytes, 0, $Bytes.Length)
} finally {
    $Stream.Dispose()
}

Write-Host '  [CREATED] bridge-test.txt' -ForegroundColor Green

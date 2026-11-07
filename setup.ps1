# One-time setup for the NTU Gemini Vibe Bridge.

Write-Host 'NTU Gemini Vibe Bridge - One-time setup' -ForegroundColor Cyan

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        Write-Host '[ERROR] Windows Package Manager is unavailable. Install Node.js LTS from https://nodejs.org/en/download, then reopen PowerShell and run setup again.' -ForegroundColor Red
        exit 1
    }

    Write-Host 'Installing Node.js LTS. Follow any Windows installer prompts.'
    winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] Node.js installation did not finish. Install Node.js LTS from https://nodejs.org/en/download, then reopen PowerShell and run setup again.' -ForegroundColor Red
        exit 1
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        Write-Host 'Node.js was installed. Close this PowerShell window, reopen it from the bridge folder, and run setup again.' -ForegroundColor Yellow
        exit 0
    }
}

$NodeVersion = node.exe --version
if ($LASTEXITCODE -ne 0 -or $NodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
    Write-Host '[ERROR] Repomix needs Node.js 22 or later. Install Node.js LTS from https://nodejs.org/en/download, then reopen PowerShell and run setup again.' -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js $NodeVersion" -ForegroundColor Green

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host '[ERROR] npm was not found. Reopen PowerShell and run setup again. If it is still missing, reinstall Node.js LTS with the default options.' -ForegroundColor Red
    exit 1
}

if (-not (Get-Command repomix.cmd -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing Repomix, the tool that packs project files.'
    npm.cmd install -g repomix
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] Repomix installation failed. Check the npm message above and your internet connection before retrying.' -ForegroundColor Red
        exit 1
    }
    if (-not (Get-Command repomix.cmd -ErrorAction SilentlyContinue)) {
        Write-Host 'Repomix was installed. Reopen PowerShell from the bridge folder and run setup again so Windows can find it.' -ForegroundColor Yellow
        exit 0
    }
}

$RepomixVersion = repomix.cmd --version
if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] Repomix was found but could not start. Check the message above before continuing.' -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Repomix $RepomixVersion" -ForegroundColor Green
Write-Host 'Setup complete. Continue with step 3 in README.md.' -ForegroundColor Green

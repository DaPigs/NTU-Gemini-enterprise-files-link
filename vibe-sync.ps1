# =============================================================================
# vibe-sync.ps1 - Watch a OneDrive folder for project changes
# Part of ntu-gemini-vibe-bridge
# =============================================================================

param (
    [string]$OneDrivePath
)

$DefaultNtuPath = Join-Path $env:USERPROFILE 'OneDrive - Nanyang Technological University'
if ($OneDrivePath) {
    $OneDriveBase = $OneDrivePath
} elseif (Test-Path -LiteralPath $DefaultNtuPath -PathType Container) {
    $OneDriveBase = $DefaultNtuPath
} elseif ($env:OneDriveCommercial -and (Test-Path -LiteralPath $env:OneDriveCommercial -PathType Container)) {
    $OneDriveBase = $env:OneDriveCommercial
} else {
    $RawOD = Read-Host "Could not auto-detect NTU OneDrive. Copy the path of your NTU OneDrive folder from File Explorer and paste it here"
    $OneDriveBase = $RawOD.Trim('"', "'", " ")
}

if ([string]::IsNullOrWhiteSpace($OneDriveBase) -or -not (Test-Path -LiteralPath $OneDriveBase -PathType Container)) {
    Write-Host "[ERROR] OneDrive folder not found at: $OneDriveBase" -ForegroundColor Red
    exit 1
}
$OneDriveBase = (Resolve-Path -LiteralPath $OneDriveBase).ProviderPath

$ProjectsRoot = Join-Path $OneDriveBase 'projects'

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   NTU Gemini Enterprise - Vibe Coding Auto-Bridge       " -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "OneDrive Root: $OneDriveBase" -ForegroundColor DarkGray

# 2. Ask for Local Project Path
$RawInputPath = Read-Host "`nEnter (or paste) your local project folder path"
$LocalPath    = $RawInputPath.Trim('"', "'", " ")

if ([string]::IsNullOrWhiteSpace($LocalPath) -or -not (Test-Path -LiteralPath $LocalPath -PathType Container)) {
    Write-Host "[ERROR] The path '$LocalPath' does not exist or is not a folder." -ForegroundColor Red
    exit 1
}

$LocalPath   = (Resolve-Path -LiteralPath $LocalPath).ProviderPath
$ProjectName = Split-Path -Path $LocalPath -Leaf
$RemotePath  = Join-Path $ProjectsRoot $ProjectName
$ContextFile = Join-Path $RemotePath "repo-context.txt"
$PatchFile   = Join-Path $RemotePath "apply-changes.ps1"

try {
    [void][System.IO.Directory]::CreateDirectory($RemotePath)
} catch {
    Write-Host "[ERROR] Could not create the OneDrive project folder: $RemotePath" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
    exit 1
}

Write-Host "`nProject Name : $ProjectName" -ForegroundColor Green
Write-Host "Local Path   : $LocalPath" -ForegroundColor Gray
Write-Host "OneDrive Bus : $RemotePath" -ForegroundColor Gray

# Default exclusion list for Repomix so repo-context.txt stays clean & under 7 MB
$IgnoreList = @(
    ".git", ".svn", ".hg", ".idea", ".vscode", ".vs",
    "node_modules", "bower_components", "jspm_packages",
    ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "dist", "build", "out", "target", "bin", "obj", ".next", ".nuxt", ".output",
    "coverage", ".gradle", ".terraform", "vendor",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
    "poetry.lock", "Pipfile.lock", "Cargo.lock", "composer.lock",
    "*.pyc", "*.pyo", "*.pyd", "*.exe", "*.dll", "*.so", "*.dylib",
    "*.zip", "*.tar", "*.gz", "*.7z", "*.rar",
    "*.mp4", "*.mov", "*.avi", "*.mp3", "*.wav",
    "*.sqlite", "*.sqlite3", "*.db", ".DS_Store", "Thumbs.db",
    "repo-context.txt", "apply-changes.ps1", "apply-changes.failed*.ps1"
) -join ","

function Invoke-RepoPack {
    $TimeStr = (Get-Date).ToString("HH:mm:ss")
    Write-Host "`n[$TimeStr] [PACK] Packing '$ProjectName' into repo-context.txt..." -ForegroundColor Cyan

    if (Get-Command repomix.cmd -ErrorAction SilentlyContinue) {
        repomix.cmd $LocalPath --style plain --output $ContextFile --ignore $IgnoreList | Out-Null
    } elseif (Get-Command npx.cmd -ErrorAction SilentlyContinue) {
        Write-Host "[$TimeStr] [INFO] Repomix is not installed globally. Trying npx repomix..." -ForegroundColor DarkYellow
        npx.cmd --yes repomix $LocalPath --style plain --output $ContextFile --ignore $IgnoreList | Out-Null
    } else {
        Write-Host "[$TimeStr] [ERROR] Repomix and npx are missing. Run setup.ps1 from the bridge folder first." -ForegroundColor Red
        return $false
    }

    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $ContextFile -PathType Leaf)) {
        $SizeMB = [math]::Round((Get-Item -LiteralPath $ContextFile).Length / 1MB, 2)
        Write-Host "[$TimeStr] [READY] repo-context.txt updated ($SizeMB MB)" -ForegroundColor Green
        if ($SizeMB -gt 7) {
            Write-Host "[$TimeStr] [WARNING] File exceeds Gemini Enterprise's 7 MB .txt limit ($SizeMB MB)!" -ForegroundColor Red
            Write-Host "           Add large asset/data folders to .repomixignore or .gitignore." -ForegroundColor Yellow
        } elseif ($SizeMB -gt 3.5) {
            Write-Host "[$TimeStr] [NOTE] File is under 7 MB ($SizeMB MB), but may approach context token limits." -ForegroundColor Yellow
        }
        return $true
    }

    Write-Host "[$TimeStr] [ERROR] Failed to update repo-context.txt. Check the error above before asking Gemini to read it." -ForegroundColor Red
    return $false
}

function Wait-FileUnlocked([string]$FilePath) {
    # Wait up to 15 seconds for OneDrive desktop sync client to finish downloading & unlock the file
    for ($i = 0; $i -lt 30; $i++) {
        try {
            if ((Test-Path -LiteralPath $FilePath -PathType Leaf) -and ((Get-Item -LiteralPath $FilePath).Length -gt 0)) {
                $Stream = [System.IO.File]::Open($FilePath, 'Open', 'Read', 'None')
                $Stream.Close()
                $Stream.Dispose()
                return $true
            }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# 3. Initial Context Pack
if (-not (Invoke-RepoPack)) { exit 1 }

# 4. Continuous Watch Loop for apply-changes.ps1
Write-Host "`n=========================================================" -ForegroundColor Yellow
Write-Host " WATCHING FOR AI PATCHES: $PatchFile" -ForegroundColor Yellow
Write-Host "    Press [R] to manually re-pack repo-context.txt" -ForegroundColor Gray
Write-Host "    Press [Q] or Ctrl+C to stop watching" -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Yellow

while ($true) {
    # Check if user pressed R (manual repack) or Q (quit)
    if (-not [Console]::IsInputRedirected -and [Console]::KeyAvailable) {
        $Key = [Console]::ReadKey($true).Key
        if ($Key -eq 'R') {
            [void](Invoke-RepoPack)
        } elseif ($Key -eq 'Q') {
            Write-Host "`nStopping watcher. Happy vibe coding!" -ForegroundColor Cyan
            break
        }
    }

    # Check if Gemini Enterprise dropped an apply-changes.ps1 file in OneDrive
    if (Test-Path -LiteralPath $PatchFile -PathType Leaf) {
        $TimeStr = (Get-Date).ToString("HH:mm:ss")
        Write-Host "`n[$TimeStr] Detected apply-changes.ps1. Waiting for OneDrive to finish syncing..." -ForegroundColor Magenta

        if (Wait-FileUnlocked $PatchFile) {
            try {
                Write-Host "[$TimeStr] Executing AI patch against: $LocalPath" -ForegroundColor Cyan
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchFile -ProjectPath $LocalPath

                if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
                    throw "Patch exited with code $LASTEXITCODE"
                }

                # Delete apply-changes.ps1 from OneDrive so it never runs twice
                Remove-Item -LiteralPath $PatchFile -Force -ErrorAction Stop
                Write-Host "[$TimeStr] Removed the completed apply-changes.ps1 from OneDrive." -ForegroundColor DarkGray

                # Automatically re-pack repo-context.txt so Gemini has the fresh state!
                [void](Invoke-RepoPack)
            } catch {
                Write-Host "[$TimeStr] [ERROR] Could not finish processing apply-changes.ps1: $_" -ForegroundColor Red
                $FailedName = 'apply-changes.failed.ps1'
                if (Test-Path -LiteralPath (Join-Path $RemotePath $FailedName)) {
                    $FailedName = 'apply-changes.failed.' + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.ps1'
                }
                try {
                    Rename-Item -LiteralPath $PatchFile -NewName $FailedName -ErrorAction Stop
                    Write-Host "[$TimeStr] Saved the failed upload as $FailedName." -ForegroundColor Yellow
                } catch {
                    Write-Host "[$TimeStr] [ERROR] The watcher stopped because it could not rename the upload: $_" -ForegroundColor Red
                    Write-Host 'Move apply-changes.ps1 out of the OneDrive project folder before restarting the watcher.' -ForegroundColor Yellow
                    exit 1
                }
            }
        } else {
            Write-Host "[$TimeStr] [WAITING] The upload is still unavailable. Check OneDrive sync and that the project folder is set to Always keep on this device." -ForegroundColor Yellow
        }
    }

    Start-Sleep -Seconds 1
}

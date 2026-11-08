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

$DeltaTool = Join-Path $PSScriptRoot 'bridge-delta.cjs'
if (-not (Test-Path -LiteralPath $DeltaTool -PathType Leaf) -or -not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Write-Host '[ERROR] The delta tool or Node.js is missing. Keep the bridge files together and run setup.ps1.' -ForegroundColor Red
    exit 1
}
$StateDir = Join-Path $LocalPath '.vibebridge-state'
try {
    [void][IO.Directory]::CreateDirectory($StateDir)
    $StateItem = Get-Item -LiteralPath $StateDir -Force -ErrorAction Stop
    if ($StateItem.LinkType) { throw 'The bridge state folder cannot be a link or junction.' }
    $LockFile = Join-Path $StateDir 'watcher.lock'
    $LockItem = Get-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    if ($LockItem.LinkType) { throw 'The watcher lock cannot be a link.' }
    $WatcherLock = [IO.File]::Open($LockFile, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    Write-Host "[ERROR] Cannot lock the project. Close any other watcher for this project. $_" -ForegroundColor Red
    exit 1
}

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
    ".vibebridge-state", "repo-context.txt", "apply-changes.ps1", "apply-changes.failed*.ps1"
) -join ","

function Resolve-AssetPath([string]$Root, [string[]]$Parts) {
    $Path = $Root
    foreach ($Part in $Parts) {
        $Path = Join-Path $Path $Part
        $Item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        if ($Item -and $Item.LinkType) {
            throw "Asset paths cannot use links or junctions: $Path"
        }
    }
    return $Path
}

function Get-AssetHash([string]$Path) {
    $Stream = [IO.File]::OpenRead($Path)
    try {
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try {
            return [BitConverter]::ToString($Hasher.ComputeHash($Stream))
        } finally {
            $Hasher.Dispose()
        }
    } finally {
        $Stream.Dispose()
    }
}

function Get-AssetFolderFiles([string]$Folder, [string]$RelativeFolder) {
    foreach ($Item in (Get-ChildItem -LiteralPath $Folder -ErrorAction Stop)) {
        $RelativePath = Join-Path $RelativeFolder $Item.Name
        if ($Item.LinkType) {
            Write-Warning "[ASSET] Skipped link or junction: $RelativePath"
        } elseif ($Item.PSIsContainer) {
            Get-AssetFolderFiles $Item.FullName $RelativePath
        } else {
            $RelativePath
        }
    }
}

function Get-SelectedAssets([string]$List) {
    foreach ($Line in (Get-Content -LiteralPath $List -Encoding UTF8 -ErrorAction Stop)) {
        $Entry = $Line.Trim().Replace('/', '\')
        if (-not $Entry -or $Entry.StartsWith('#')) { continue }

        $AsText = $Entry.StartsWith('base64:', [StringComparison]::OrdinalIgnoreCase)
        if ($AsText) { $Entry = $Entry.Substring(7).Trim() }

        $IsFolder = $Entry.EndsWith('\')
        $Entry = $Entry.TrimEnd('\')
        $Parts = $Entry.Split('\')
        if ($Parts[0] -ne 'assets' -or (-not $IsFolder -and $Parts.Count -lt 2) -or
            ($Parts | Where-Object { -not $_ -or $_ -match '[<>:"|?*\x00-\x1f]|[. ]$' })) {
            throw "List a relative path under assets/ in .vibebridge-assets.txt: $Line"
        }

        if ($IsFolder -and $AsText) {
            throw "Use base64: with an individual asset file: $Line"
        }
        if ($IsFolder) {
            $Folder = Resolve-AssetPath $LocalPath $Parts
            if (-not (Test-Path -LiteralPath $Folder -PathType Container)) {
                Write-Warning "[ASSET] Local folder missing: $Entry. Check for older copies in OneDrive."
                continue
            }
            Get-AssetFolderFiles $Folder $Entry
        } elseif ($AsText) {
            "base64:$Entry"
        } else {
            $Entry
        }
    }
}

function Read-AssetBase64([string]$Path, [long]$MaximumBytes) {
    $Stream = [IO.File]::OpenRead($Path)
    try {
        $Length = $Stream.Length
        if ($Length -gt $MaximumBytes) { return $null }
        $Reader = [IO.BinaryReader]::new($Stream)
        try {
            $Bytes = $Reader.ReadBytes([int]$Length)
            if ($Bytes.LongLength -ne $Length) { throw "Asset changed while reading: $Path" }
            return [Convert]::ToBase64String($Bytes)
        } finally {
            $Reader.Dispose()
        }
    } finally {
        $Stream.Dispose()
    }
}

$AssetFingerprints = @{}

function Sync-OneDriveAssets {
    $List = Join-Path $LocalPath '.vibebridge-assets.txt'
    if (-not (Test-Path -LiteralPath $List -PathType Leaf)) { return }

    $Seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($Selection in (Get-SelectedAssets $List)) {
        if (-not $Seen.Add($Selection)) { continue }
        $AsText = $Selection.StartsWith('base64:')
        $Entry = if ($AsText) { $Selection.Substring(7) } else { $Selection }
        $Parts = $Entry.Split('\')

        $Source = Resolve-AssetPath $LocalPath $Parts
        if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
            if (Test-Path -LiteralPath $Source -PathType Container) {
                throw "List individual asset files, not folders: $Entry"
            }
            Write-Warning "[ASSET] Local file missing: $Entry. Check for an older copy in OneDrive."
            continue
        }

        $DestinationParts = $Parts
        $LocalFile = Get-Item -LiteralPath $Source -ErrorAction Stop
        if ($AsText) {
            $DestinationParts = @('asset-bytes') + $Parts[1..($Parts.Count - 1)]
            $DestinationParts[-1] += '.base64.txt'
        }
        $Destination = Resolve-AssetPath $RemotePath $DestinationParts
        if ([string]::Equals($Source, $Destination, [StringComparison]::OrdinalIgnoreCase)) {
            Write-Host "[ASSET] Already in OneDrive folder: $Entry" -ForegroundColor Gray
            continue
        }

        $OneDriveFile = $null
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            $OneDriveFile = Get-Item -LiteralPath $Destination -ErrorAction Stop
            $Fingerprint = "$($LocalFile.Length):$($LocalFile.LastWriteTimeUtc.Ticks):$($OneDriveFile.Length):$($OneDriveFile.LastWriteTimeUtc.Ticks)"
            if ($AssetFingerprints[$Selection] -eq $Fingerprint) { continue }
        }

        $Text = $null
        if ($AsText) {
            $Text = Read-AssetBase64 $Source 3MB
            if ($null -eq $Text) {
                Write-Warning "[ASSET] Base64 copy skipped for $Entry (source exceeds 3 MiB). Check for an older text copy in OneDrive."
                continue
            }
            $Unchanged = $OneDriveFile -and $OneDriveFile.Length -eq $Text.Length -and
                [IO.File]::ReadAllText($Destination) -ceq $Text
        } else {
            $Unchanged = $OneDriveFile -and $LocalFile.Length -eq $OneDriveFile.Length -and
                (Get-AssetHash $Source) -eq (Get-AssetHash $Destination)
        }
        if ($Unchanged) {
            $AssetFingerprints[$Selection] = $Fingerprint
            continue
        }
        $AssetFingerprints.Remove($Selection)

        $Folder = [IO.Path]::GetDirectoryName($Destination)
        [void][IO.Directory]::CreateDirectory($Folder)
        $Temp = Join-Path $Folder ('.vibe-asset-' + [guid]::NewGuid().ToString('N') + '.tmp')
        try {
            if ($AsText) {
                [IO.File]::WriteAllText($Temp, $Text, [Text.Encoding]::ASCII)
            } else {
                [IO.File]::Copy($Source, $Temp)
            }
            if (Test-Path -LiteralPath $Destination -PathType Leaf) {
                [IO.File]::Replace($Temp, $Destination, [NullString]::Value)
            } else {
                [IO.File]::Move($Temp, $Destination)
            }
        } finally {
            if ([IO.File]::Exists($Temp)) { [IO.File]::Delete($Temp) }
        }

        $PublishedPath = $DestinationParts -join '\'
        Write-Host "[ASSET] Copied to OneDrive folder: $PublishedPath" -ForegroundColor Green
    }
}

function Invoke-RepoPack {
    $TimeStr = (Get-Date).ToString("HH:mm:ss")
    Write-Host "`n[$TimeStr] [PACK] Packing '$ProjectName' into repo-context.txt..." -ForegroundColor Cyan

    $PackedFile = Join-Path $StateDir ('packed-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        if (Get-Command repomix.cmd -ErrorAction SilentlyContinue) {
            repomix.cmd $LocalPath --style json --output $PackedFile --ignore $IgnoreList | Out-Null
        } elseif (Get-Command npx.cmd -ErrorAction SilentlyContinue) {
            npx.cmd --yes repomix $LocalPath --style json --output $PackedFile --ignore $IgnoreList | Out-Null
        } else {
            throw 'Repomix and npx are missing. Run setup.ps1 from the bridge folder.'
        }
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $PackedFile -PathType Leaf)) {
            throw 'Repomix did not generate a snapshot.'
        }
        Sync-OneDriveAssets
        node.exe $DeltaTool snapshot $LocalPath $PackedFile $ContextFile | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw 'Could not publish the v2 snapshot.' }
    } catch {
        Write-Host "[$TimeStr] [ERROR] Snapshot refresh failed: $_" -ForegroundColor Red
        return $false
    } finally {
        Remove-Item -LiteralPath $PackedFile -Force -ErrorAction SilentlyContinue
    }

    $SizeMB = [math]::Round((Get-Item -LiteralPath $ContextFile).Length / 1MB, 2)
    Write-Host "[$TimeStr] [READY] repo-context.txt updated ($SizeMB MB)" -ForegroundColor Green
    if ($SizeMB -gt 7) {
        Write-Warning 'The snapshot exceeds 7 MB. Exclude large files with .repomixignore.'
    } elseif ($SizeMB -gt 3.5) {
        Write-Warning 'The snapshot may approach Gemini context limits.'
    }
    return $true
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

    # Treat the synced .ps1 filename as data only.
    if (Test-Path -LiteralPath $PatchFile -PathType Leaf) {
        $TimeStr = (Get-Date).ToString("HH:mm:ss")
        Write-Host "`n[$TimeStr] Detected apply-changes.ps1. Waiting for OneDrive to finish syncing..." -ForegroundColor Magenta

        if (Wait-FileUnlocked $PatchFile) {
            try {
                Write-Host "[$TimeStr] Validating v2 patch against: $LocalPath" -ForegroundColor Cyan
                node.exe $DeltaTool apply $LocalPath $PatchFile

                if ($LASTEXITCODE -ne 0) {
                    throw "Patch was rejected or could not finish (exit $LASTEXITCODE)."
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

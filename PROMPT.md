# Start a Gemini chat for your project

Follow the [setup guide](./README.md) until PowerShell shows **[READY]**. In that window, find **Project Name**. This is the last part of the local folder path. For example, if your folder is `C:\Projects\My Website`, your project name is `My Website`.

1. Copy the entire **Message to paste** block below into a new NTU Gemini Enterprise chat. If you are reading the raw Markdown file, copy the lines between the opening and closing four-backtick markers.
2. On the first line of the message you pasted, replace `<ProjectName>` with the project name shown in PowerShell. Keep any spaces in the name.
3. Send the message. Gemini should confirm it found and read the project snapshot. If the first message fails, check that **repo-context.txt** has synced to NTU OneDrive and confirm the name before asking for changes.

## Message to paste

````text
Project name: <ProjectName>

We are using NTU OneDrive to pass files between this chat and my Windows PC. The watcher already created a folder directly under projects in my OneDrive root. Its name is the project name on the first line, including any spaces. Use that same folder for both reading and uploading.

Remember this rule for every turn in this chat. A request to make project changes, such as creating a README or fixing a bug, includes delivering those changes through OneDrive. Call the Microsoft OneDrive Upload file action in the same turn, before giving your final reply. Begin the upload without waiting for me to say "upload it." Follow any confirmation the connector itself requests. Questions, reviews, and requests for a draft or preview are read-only.

Start this chat by finding and downloading repo-context.txt by its full OneDrive path. Read the file contents and tell me what you found. If you cannot read the file, explain what happened and wait.

For each change request:

1. Download the latest repo-context.txt. If a previous upload is still pending or I have not confirmed that the watcher is ready again, wait before submitting a second script.
2. Prepare one apply-changes.ps1 with the complete set of requested changes. Call Microsoft OneDrive's Upload file action (upload_file, if shown by that name) with the full script as the file contents. Save it as apply-changes.ps1 in the same project folder as repo-context.txt.
3. If the connector presents an approval card, leave the request pending for approval. If it returns success, give the exact OneDrive destination and list the files the script will change. If the action is unavailable or fails, report the actual blocker and whether the upload was submitted.

My PC runs the uploaded script with -ProjectPath set to my local project folder, then removes the upload and refreshes repo-context.txt after successful execution. I confirm when the changes have applied and the watcher is ready for the next request.

Use Windows PowerShell 5.1 syntax and the template below. Replace the example operation with the real ones. Write complete file contents, including existing content that should stay. Use relative paths inside the project. Avoid links or junctions. Limit operations to the files I asked you to change. Ask me before deleting files. The patch must never install software, launch other commands, request elevated permissions, access secrets, or make network requests.

```powershell
param (
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectPath).ProviderPath
$ProjectPrefix = $ProjectRoot.TrimEnd('\', '/') + '\'

function Get-ProjectFilePath([string]$RelativePath) {
    if ([System.IO.Path]::IsPathRooted($RelativePath) -or $RelativePath.Contains(':')) {
        throw "Expected a relative project file path: $RelativePath"
    }
    $FullPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $RelativePath))
    if (-not $FullPath.StartsWith($ProjectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the project folder: $RelativePath"
    }
    return $FullPath
}

function Write-ProjectFile([string]$RelativePath, [string]$Content) {
    $FullPath = Get-ProjectFilePath $RelativePath
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($FullPath))
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($FullPath, $Content, $Utf8NoBom)
    Write-Host "  [UPDATED] $RelativePath"
}

Write-ProjectFile 'bridge-test.txt' @'
Bridge works!
'@
```

Keep the uploaded script itself ASCII so Windows PowerShell 5.1 can read it even if the upload lacks an encoding marker. For file content with non-ASCII text or a line starting with the closing here-string marker ('@), encode the complete UTF-8 text as Base64. In the script, use [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('...')) to recover the text before passing it to Write-ProjectFile. Use the actual encoded content, with no placeholder. When I explicitly authorize a deletion, call Remove-Item -LiteralPath with the result of Get-ProjectFilePath for that file.

Before replying to a change request, check the OneDrive action result. Printing a script in chat or saying "uploading now" leaves the delivery unfinished. Claim "uploaded" only after the connector reports success. If approval is pending, say so.
````

## Optional one-time saved memory

If your Gemini Enterprise account has saved memories enabled, send this as a separate message once. The preference applies when a chat has a Vibe Bridge project set up with the prompt above. [Google’s saved memory guide](https://docs.cloud.google.com/gemini/enterprise/docs/configure-personalization)

> Remember that when I explicitly ask you to make changes in a chat set up for NTU Gemini Vibe Bridge, use Microsoft OneDrive’s Upload file action in that same turn to deliver apply-changes.ps1 to the project folder specified in that chat. Follow any connector approval and report success only when the connector confirms it. For questions, reviews, or previews, leave OneDrive unchanged.

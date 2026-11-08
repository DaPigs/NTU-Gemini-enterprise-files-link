# NTU Gemini Files link

Use NTU Gemini Enterprise to edit a project folder on your Windows PC. You describe the changes in chat, and the bridge moves them through your NTU OneDrive.

**Current workflow.** Import both [skill ZIPs](#5-import-the-gemini-skills-and-start-a-chat), start the Windows watcher, and ask for a change in a Gemini chat with `/vibecode <ProjectName>`. The skill prepares a Delta v2 package and requests the OneDrive upload in the same turn. QuickCafeRetest completed that workflow in 2m59s. If Gemini stops after preparing a valid package, use `/syncvibecode now` in the same chat or paste the [manual upload prompt](#finish-delivery-if-gemini-stops-early).

Each change travels as one data package named `apply-changes.ps1`. The watcher checks the project, snapshot, patch ID, and file operations before applying it. Text edits match the current file. New UTF-8 files use plain text in the package, and binary files and full-file replacements use Base64. See [TEST_LOG.md](./TEST_LOG.md) for the live tests and local checks.

**Start with a practice folder.** The watcher applies verified changes under your selected local project. Keep a backup and use files you are allowed to share with Gemini. The browser switch controls approval clicks. The watcher has its own PowerShell window.

## 1. Get the project files

You need Windows 10 or 11, the OneDrive desktop app signed in to your NTU account, and access to [NTU Gemini Enterprise](https://vertexaisearch.cloud.google.com/) with Microsoft OneDrive read and write actions. Use Chrome or Edge if you want the optional browser switch and completion alerts.

1. If you are viewing the project on GitHub, choose **Code → Download ZIP**. In **Downloads**, right-click the ZIP and choose **Extract All… → Extract**. If someone gave you the project folder directly, open that folder in File Explorer.
2. Open the folder that contains [setup.ps1](./setup.ps1), [vibe-sync.ps1](./vibe-sync.ps1), [bridge-delta.cjs](./bridge-delta.cjs), and [start-vibe-bridge.cmd](./start-vibe-bridge.cmd). Keep the project files together.
3. In File Explorer, click the address bar at the top, type `powershell`, and press **Enter**. A PowerShell window opens in that folder. Paste commands into that window with **Ctrl+V**, then press **Enter**. Use your regular Windows account for these steps.

## 2. Install the tools that prepare your files

Run this command in PowerShell.

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\setup.ps1
```

The setup installs or checks **Node.js**, which runs the file-packing tool, and **Repomix**, which collects your project files into a single text file. If Windows asks to install Node.js, check that the installer is for Node.js before proceeding. Wait for **Setup complete**.

- **Setup says to reopen PowerShell.** Close the window, reopen PowerShell from the same File Explorer folder, and run the same command. Windows sometimes needs a fresh window to find newly installed tools.
- **Setup says Node.js is missing or too old.** Download the Windows **LTS** installer from the [official Node.js download page](https://nodejs.org/en/download). Use the installer defaults, close PowerShell, then reopen it and rerun setup. Repomix requires Node.js 22 or later. [Repomix requirements](https://repomix.com/guide/installation)
- **Windows says the script is unsigned or downloaded from the internet.** If you trust the copy you downloaded, in File Explorer right-click **setup.ps1**, choose **Properties**, tick **Unblock** if shown, and select **Apply**. Repeat for **vibe-sync.ps1**. Rerun the command. If your school or employer manages script execution, ask their IT team for help. [Microsoft’s PowerShell execution policy guide](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)

## 3. Prepare NTU OneDrive

1. Open the **OneDrive** app from the Windows Start menu and sign in with your NTU account. In File Explorer, open **OneDrive – Nanyang Technological University**. If there are several OneDrive folders, use the one for your NTU account.
2. Inside that OneDrive folder, create a folder named **projects** if it is missing. Right-click **projects**, choose **Always keep on this device**, and wait for OneDrive to finish syncing. This downloads files Gemini puts there so the watcher can read them. [Microsoft’s OneDrive guide](https://support.microsoft.com/en-us/onedrive/save-disk-space-with-onedrive-files-on-demand-for-windows)
3. Open [NTU Gemini Enterprise](https://gemini.ntu.edu.sg/) and sign in with your NTU account. In a chat, look for **OneDrive** in the available connectors (puzzle icon) or for **+ → Add from OneDrive Business**. Follow the Microsoft sign-in prompt using the same NTU account. The file picker can help connect your account, but the practice test below also checks whether Gemini can upload. If OneDrive is missing, write actions are unavailable, or you see **Need admin approval**, ask your organization’s Gemini or Microsoft administrator. [Google’s OneDrive connector guide](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/ms-onedrive) · [Google’s chat guide](https://docs.cloud.google.com/gemini/enterprise/docs/assistant-chat)

## 4. Start the watcher with a practice folder

1. In File Explorer, enter `%LOCALAPPDATA%` in the address bar and press **Enter**. Create a folder named **VibeBridgePractice**. If that name already exists, add a number so the practice folder has its own name. This is the **local project folder** where the practice file will appear.
2. Open the practice folder in File Explorer. Press **Ctrl+L**, then **Ctrl+C** to copy its full path. In a new Notepad document, type `This is the Vibe Bridge practice project.` and choose **File → Save as**. Paste the folder path into the Save As window’s address bar and press **Enter**. In **File name**, enter **hello.txt**. Choose **All files** if you see a **Save as type** menu, then select **Save**.
3. In File Explorer, return to the **bridge folder** from step 1 and double-click **start-vibe-bridge.cmd**. If file extensions are hidden, look for **start-vibe-bridge** with the type **Windows Command Script**. A window opens. At the prompt, paste the full path to **VibeBridgePractice** and press **Enter**. If asked for the OneDrive path, paste the path to the NTU OneDrive folder itself and press **Enter**.
4. Check that **OneDrive Root** points to your NTU OneDrive and **Local Path** points to the practice folder. **OneDrive Bus** should show the practice folder under `projects` in your NTU OneDrive. Wait for **[READY] repo-context.txt updated** and **WATCHING FOR AI PATCHES**. Keep the PowerShell window open. In File Explorer, wait for `projects\VibeBridgePractice\repo-context.txt` to finish syncing. Open it in Notepad and look for the sentence you typed.

> **Two folders to remember.** Gemini reads and writes inside **NTU OneDrive → projects → VibeBridgePractice**. Your actual project files, including **hello.txt**, are in the **local practice folder**. Use the same project name in both places if you added a number.

## 5. Import the Gemini skills and start a chat

1. In Gemini Enterprise, open **Skills** in the left menu. Choose **+ → Upload skill**, select [vibecode.zip](./vibecode.zip), and click **Import**. Repeat for [syncvibecode.zip](./syncvibecode.zip). Upload each ZIP as-is. Each includes its instructions and Python helper. [Google’s skill guide](https://docs.cloud.google.com/gemini/enterprise/docs/skills#upload_a_skill_to_the_web_app)
2. Open a regular **New chat**. Type `/` in the message box and choose **vibecode** from the skill menu. After the skill mention, type the exact **Project Name** shown by the watcher. For the practice folder, the first line should look like `/vibecode VibeBridgePractice`. Add your request on the next line.
3. Send the skill and project name with this request on the next line. A matching sentence confirms Gemini can read the snapshot.

   > Read `repo-context.txt` from this project’s OneDrive folder and quote the sentence in `hello.txt`.

If you already installed an older version, replace the old skills by importing the current ZIPs, then open a fresh chat. If **Skills** or **Upload skill** is missing, use the **Message to paste** block in [PROMPT.md](./PROMPT.md). Replace the project name on the first line before sending it.

## 6. Send a practice change and confirm it applied

1. In the chat from step 5, send this change request. Leave the browser switch off for the first practice run so you can see the OneDrive confirmation.

   > Create `bridge-test.txt` containing the sentence `Bridge works!`. Keep the other project files as they are. Use OneDrive to deliver the verified delta package.

2. Look for a OneDrive **Upload file** confirmation or an actual upload result. If Gemini prepared a patch but stopped before uploading it, use `/syncvibecode now` or copy the [manual upload prompt](#finish-delivery-if-gemini-stops-early).
3. When a confirmation appears, check that it uploads **apply-changes.ps1** to the OneDrive folder for your practice project. Click **Send**, or let the [optional browser switch](#optional-browser-switch-and-completion-alerts) approve the card if you have enabled it.
4. In PowerShell, look for **[PATCH]** with the patch ID, **[APPLIED]** for the same ID, and a new **[READY]**. The watcher lists each affected file below **[APPLIED]**. For this test, look for `[CREATE] bridge-test.txt`. Open the file in your **local practice folder** and check the sentence. After a successful apply, the watcher removes the completed upload from OneDrive and publishes a fresh snapshot.

### Finish delivery if Gemini stops early

If Gemini prepared `apply-changes.ps1` but stopped before uploading it, select **syncvibecode** in the **same Gemini chat** and type `now` after the skill mention. Send `/syncvibecode now` to check the retained package’s format and upload its exact text. This skips Gemini’s snapshot and upload-slot checks and repackaging. The watcher validates the patch when it arrives.

If the package is missing or malformed, use `/syncvibecode` without `now`. That mode checks the snapshot and recovers the tested files so Gemini can rebuild the package. If a OneDrive confirmation is already pending, approve that card.

**Manual upload prompt**

To request the same immediate upload without the skill, copy this block into the **same chat**.

```text
Retrieve the exact delta prepared for the previous change. In Python, read the exact text as ASCII and validate it with validate_delta_envelope(content, project) from the start prompt, or check the same fields directly in Python if the helper is unavailable. It must have the VibeBridge Delta v2 header and a JSON object with version 2, the exact project, snapshotId, patchId, and operations. If the package is missing or malformed, report that blocker and suggest plain /syncvibecode for verified recovery.

Skip snapshot and slot checks, file reconstruction, tests, and repackaging. Resolve the original project folder by exact path only if its ID is required and unavailable. If an earlier upload succeeded, is pending approval, or has an uncertain outcome, report its status.

Call the registered OneDrive Upload file action with the exact retained package as direct Content. Keep the patch ID, set FileName to apply-changes.ps1, and set HasBytes to false when available. Use apply-changes.ps1 as InputFileName if required. Reply with the connector result, pending approval, or exact blocker. Keep tool markup, source, and package text out of the visible reply.
```

Approve the OneDrive card when it appears. Wait for **[APPLIED]** and a fresh **[READY]** before sending another change.

## Everyday use

1. Back up your project and review it for secrets or private files before starting the watcher. To exclude files, create `.repomixignore` in the local project folder and list one project-relative path or pattern per line. Use Notepad’s **All files** option when saving. [Repomix’s security guide](https://repomix.com/guide/security)
2. Double-click [start-vibe-bridge.cmd](./start-vibe-bridge.cmd), select the local folder, and wait for **[READY]** and OneDrive sync. Use distinct folder names for projects and run one watcher per project.
3. In a new chat, select `/vibecode`, enter that project’s exact folder name, and describe one change. If Gemini stops after preparing it, use `/syncvibecode now` or the [manual upload prompt](#finish-delivery-if-gemini-stops-early) in the same chat. Approve the resulting card and wait for **[APPLIED]** and a fresh **[READY]** before asking for the next change.
4. After editing files yourself, press **R** in the watcher and wait for the fresh snapshot to sync before asking Gemini for another change. While Gemini is preparing or delivering a patch, leave the target files alone. A text edit checks its matching section, and a full-file replacement writes the supplied bytes over the current file. Press **Q** to stop the watcher. If an upload was pending when you stopped, check the OneDrive project folder before restarting.

For a manual review before application, turn off auto-approval and stop the watcher with **Q** before you approve the upload. Open the downloaded `apply-changes.ps1` as text in Notepad. Move the reviewed upload out of the inbox before restarting. The watcher publishes a fresh snapshot at startup, so ask Gemini to prepare the patch for that snapshot.

When upgrading from an older bridge version, close the old watcher and start the new one. Update the imported skill or use the current prompt, then start a fresh chat. The current watcher reads Delta v2 data from `apply-changes.ps1` and rejects older executable packages.

## Optional browser switch and completion alerts

You can use the whole bridge by clicking **Send** yourself. Install this part if you want Gemini completion alerts or automatic approval of Gemini confirmation cards.

1. Install [Tampermonkey](https://www.tampermonkey.net/) for Chrome or Edge. In Chrome, open `chrome://extensions` in the address bar, choose **Details** on the Tampermonkey card, and enable **Allow User Scripts** if shown. In Edge, open `edge://extensions` and follow Tampermonkey’s browser-specific steps if the toggle is absent. [Tampermonkey permissions guide](https://www.tampermonkey.net/faq.php#Q209)
2. In File Explorer, right-click **ntu-gemini-auto-approve.user.js** and choose **Open with → Notepad**. Press **Ctrl+A**, then **Ctrl+C** to copy the entire file. If Windows hides extensions, look for **ntu-gemini-auto-approve.user** with type **JavaScript File**.
3. Click the Tampermonkey icon in the browser’s **Extensions** menu. Choose **Create a new script…**. Click inside the editor, press **Ctrl+A**, then **Ctrl+V** to replace the example text, and press **Ctrl+S**. If an older copy is already installed, replace its contents from the Tampermonkey dashboard and leave only one enabled copy.
4. Refresh the Gemini tab. The **auto-approve Send** switch appears near the bottom-right and starts off. Drag it to move it. When green, it keeps the authorized OneDrive connector enabled and clicks **Send** once on each enabled Gemini confirmation card, including cards already open. The switch applies to every connector and destination. Turn it off to review confirmations yourself. Turn the widget off before intentionally switching OneDrive off in Gemini. When it turns green, your browser may ask whether to allow desktop notifications. If you want notifications with approval off, allow notifications in the Gemini site settings or turn the switch back off after granting permission.

Select **Copy prompt** next to the auto-approve switch, then paste into a new Gemini chat with **Ctrl+V**. Replace the project name on the first line before sending.

The widget shows elapsed time and automatic confirmation clicks for the current turn. Both reset when the widget switches to working for a new Gemini turn and freeze when it shows DONE. Clicking back into the page keeps the finished values visible. The alert means Gemini finished its chat turn. Check PowerShell for **[APPLIED]** and **[READY]** to confirm local completion. The title flashes once a second when the browser allows it. The browser can delay alerts and title flashing in background tabs. Click inside Gemini to clear the flashing title and checkmark icon.

## Share assets back to Gemini

By default the watcher sends the text snapshot. Share the assets that Gemini needs for your task. For a practice round trip, ask Gemini to create a PNG and WAV before setting up asset sharing.

> Create a valid 16 × 16 PNG at `assets/preview.png` and a small stereo 16-bit PCM WAV at `assets/sample.wav`. Use Python to generate both files. Include both files as Base64 in a single VibeBridge delta upload and report their byte lengths.

Use the same [delivery follow-up](#finish-delivery-if-gemini-stops-early) if needed. After **[APPLIED]**, verify that both assets exist in your local project. In File Explorer, open the **local project folder**, type `powershell` in its address bar, and run:

```powershell
Get-Item -LiteralPath .\assets\preview.png, .\assets\sample.wav | Select-Object Name,Length
```

Compare the file lengths with Gemini’s reported values.

To give Gemini access to selected local files, add a text file named `.vibebridge-assets.txt` in your **local project folder**, next to the `assets` folder. In Notepad, choose **All files** when saving so the name has only one `.txt` ending. Put one project-relative file path per line. For the practice project, paste:

```
assets/preview.png
assets/sample.wav
base64:assets/sample.wav
```

For a few files, use exact filenames under `assets/`. To share a whole folder and its subfolders, use one line ending in a slash, such as `assets/icons/`. Use `assets/` to share the whole tree. A folder entry includes newly added files on the next refresh. Folder entries skip hidden files and links. List only files or folders you want copied into your NTU OneDrive. The watcher checks the list at startup, when you press **R**, and after it applies a patch. It copies changed files to the corresponding `projects/<ProjectName>/assets/` path, keeping their original extensions and bytes. If you change a copy in OneDrive, a later refresh uses the local project file as the source of truth.

Press **R** to publish the selected files. After the watcher prints **[ASSET] Copied to OneDrive folder**, wait for OneDrive to finish syncing. Then ask Gemini to download the asset by its full OneDrive path and report whether it received the file bytes. A successful lookup only confirms that the file exists. The connector may still limit which files it can open or pass to Python.

To stop sharing an asset, remove the line that selects it, or narrow the folder entry in `.vibebridge-assets.txt`, then remove the OneDrive copy. The watcher reports missing local files so you can check for older copies in OneDrive.

### When Gemini says an asset type is unsupported

Keep the original file and add a second entry to `.vibebridge-assets.txt` that starts with `base64:`. For example:

```
assets/
base64:assets/sample.wav
```

After the next refresh and OneDrive sync, the WAV is available as plain Base64 text at `projects/<ProjectName>/asset-bytes/sample.wav.base64.txt`. Subfolders under `assets/` are preserved under `asset-bytes/`. Ask Gemini to download the entire text file and decode it in Python with `base64.b64decode(text.strip(), validate=True)`. It can then read the recovered bytes. The text contains the exact original bytes in an encoded form.

Use `base64:` for individual files up to 3 MiB. It creates a separate copy, so reserve it for assets that need this format. If Gemini gets only an excerpt from the connector, try attaching the same text file to the chat directly. To stop sharing a text copy, remove the `base64:` entry and the matching file under `asset-bytes/`.

### Test a read back in Gemini

After the watcher prints **[ASSET] Copied to OneDrive folder**, wait for OneDrive to finish syncing. Send the following message in a chat that already has the project selected. Replace `<ProjectName>` with the project name shown by the watcher.

> Download `projects/<ProjectName>/assets/preview.png` and the complete `projects/<ProjectName>/asset-bytes/sample.wav.base64.txt` from OneDrive. In Python, compute the PNG's byte length. Decode the full WAV text with `base64.b64decode(text.strip(), validate=True)` and compute the decoded file's byte length. Report the WAV's channel count, sample rate, and first four stereo sample pairs. Tell me if either download returned only metadata or an excerpt. Do not upload or modify anything.

Use the `Get-Item` command at the start of this section to compare the reported byte lengths.

**Verified NTU connector test.** In `VibeBridgeIntegrationTest`, Gemini read the 136-byte PNG directly. Its connector rejected the original WAV file type. It downloaded all 87,100 bytes of the Base64 text copy, decoded them to a 65,324-byte WAV, and recovered the expected signed stereo samples for frames 250–253.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| PowerShell says it cannot find `setup.ps1` | Open the extracted folder that contains it. Type `powershell` into that File Explorer window’s address bar and retry setup. |
| The launcher says it cannot find `vibe-sync.ps1` | Open the extracted folder in File Explorer and double-click the launcher there. Keep `start-vibe-bridge.cmd` and `vibe-sync.ps1` together. |
| **OneDrive Root** shows the wrong account | Press **Q** if the watcher is running. Restart with the command below, replacing the example path with the full path copied from the NTU OneDrive folder’s address bar. |
| Gemini can read OneDrive but cannot upload | Check that OneDrive write actions are available in your Gemini app. The ability to add or read a file alone does not confirm write access. |
| Gemini says a `.wav`, `.bin`, or `vibe-payload-…` file is missing from the attachment list | Start a new chat with the updated prompt. The PNG and WAV should be included as Base64 create or replace operations in the one `apply-changes.ps1` upload. |
| Gemini finds the WAV but says its type is unsupported | Add the Base64 entry, press **R**, wait for OneDrive to sync, and ask for the complete text copy under **asset-bytes**. |
| Gemini prints tool-call text or ends after preparing a package | Look for a real OneDrive approval card or connector result. If neither appears, use `/syncvibecode now` or the [manual upload prompt](#finish-delivery-if-gemini-stops-early) in the same chat. Use plain `/syncvibecode` if the package needs to be rebuilt. |
| Gemini reports an upload and you see no local change | Check the watcher for **[APPLIED]** or a rejection. In File Explorer, check the matching NTU OneDrive project folder for the exact name `apply-changes.ps1`. Verify OneDrive is syncing and the watcher is open for the same project. `apply-changes.ps1.txt` will not trigger it. Enable file extensions under **View → Show → File name extensions** in Windows 11, or the **View** tab in Windows 10. |
| The watcher rejects a stale snapshot | Press **R** and wait for OneDrive to sync. Copy the ID from the newest **[SNAPSHOT]** line and include `VibeBridge: snapshot <ID>` on its own line in your next change request. Gemini compares the ID with the downloaded snapshot, and the watcher checks the ID again before applying the patch. |
| The watcher rejects a duplicate patch or executable upload | Press **R**, wait for OneDrive to sync, and ask Gemini to use the updated prompt and fresh snapshot. If the watcher reports an interrupted transaction, inspect the backups and recovery details under **.vibebridge-state/pending** before continuing. |
| The context is too large | Use **.repomixignore** to exclude bulky files or work on a smaller folder. Press **R** and wait for OneDrive to sync. Google lists a 7 MB text attachment limit, and a model’s usable context can be smaller. [Gemini file limits](https://docs.cloud.google.com/gemini/enterprise/docs/assistant-chat#upload_and_chat_about_files) |
| The browser switch is missing | Confirm that Tampermonkey and the saved script are enabled, check the browser’s userscript permission, then refresh the **Gemini Enterprise** tab. |
| The switch shows Done but there is no desktop alert | Check the Gemini site’s notification permission, Windows notification settings, and whether the browser or the system has muted the alert. |

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\vibe-sync.ps1 -OneDrivePath "C:\Users\YourName\OneDrive - Nanyang Technological University"
```

### Test the watcher without Gemini

With the practice watcher running and **[READY]** showing, open PowerShell in the bridge folder. Paste the command below. It asks for the **Local Path** and **OneDrive Bus** paths shown by the watcher, then prepares a sample tied to that snapshot. The sample creates `bridge-test.txt`, `assets/preview.png`, and a small stereo WAV at `assets/sample.wav` in a fresh practice folder.

```powershell
$project = Read-Host 'Paste the Local Path'
$inbox = Read-Host 'Paste the OneDrive Bus path'
node .\bridge-delta.cjs sample $project .\apply-changes.ps1 (Join-Path $inbox 'apply-changes.ps1')
```

Add the three entries from [Share assets back to Gemini](#share-assets-back-to-gemini) to your local practice folder’s `.vibebridge-assets.txt` and press **R** in the watcher. In the OneDrive practice folder, look for **asset-bytes/sample.wav.base64.txt**. To check it without Gemini, open PowerShell in the **local practice folder** and paste the following. When prompted, paste the **OneDrive Bus** folder path shown by the watcher.

```powershell
$oneDriveProject = Read-Host 'Paste the OneDrive Bus folder path'
$text = [IO.File]::ReadAllText((Join-Path $oneDriveProject 'asset-bytes\sample.wav.base64.txt'))
$wav = [Convert]::FromBase64String($text)
$original = [IO.File]::ReadAllBytes((Join-Path (Get-Location).ProviderPath 'assets\sample.wav'))
if ($wav.Length -ne 60 -or [Convert]::ToBase64String($original) -cne $text) { throw 'WAV verification failed.' }
'Verified: the text copy decodes to the original WAV.'
```

Use a fresh practice folder for the [live Gemini change test](#6-send-a-practice-change-and-confirm-it-applied).

## Project files

The launcher, watcher, and delta validator sit together in the bridge folder so the launcher can find its helpers.

| File | Purpose |
| --- | --- |
| [setup.ps1](./setup.ps1) | Installs or checks the local tools. |
| [start-vibe-bridge.cmd](./start-vibe-bridge.cmd), [vibe-sync.ps1](./vibe-sync.ps1), [bridge-delta.cjs](./bridge-delta.cjs) | Start the watcher, publish snapshots, and apply verified deltas. |
| [vibecode.zip](./vibecode.zip) | Importable `/vibecode` skill for coding and delivery. |
| [syncvibecode.zip](./syncvibecode.zip) | Importable `/syncvibecode` skill for finishing or recovering an upload. |
| [PROMPT.md](./PROMPT.md) | Standalone coding and upload prompts. |
| [ntu-gemini-auto-approve.user.js](./ntu-gemini-auto-approve.user.js) | Optional Tampermonkey controls and alerts. |
| [apply-changes.ps1](./apply-changes.ps1) | Data template for the offline practice test. |
| [TEST_LOG.md](./TEST_LOG.md) | Chronological results from local and live testing. |

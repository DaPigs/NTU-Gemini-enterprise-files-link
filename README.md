# NTU Gemini enterprise files link

Use NTU Gemini Enterprise to edit a project folder on your Windows PC. You describe the changes in chat, and the bridge moves them through your NTU OneDrive.

**Start with the practice folder in this guide.** The PowerShell window that runs the bridge is called the *watcher*. While it is running, it automatically runs any file named `apply-changes.ps1` that arrives in the matching OneDrive folder. That file runs with your Windows account's permissions and can edit or delete files. Keep the OneDrive folder private, keep a backup of any real project, and use the bridge only with files you are allowed to share with NTU Gemini. The browser switch controls upload approvals. Turning it off still leaves the watcher running.

## 1. Get the project files

You need Windows 10 or 11, the OneDrive desktop app signed in to your NTU account, and access to [NTU Gemini Enterprise](https://vertexaisearch.cloud.google.com/) with Microsoft OneDrive read and write actions. Use Chrome or Edge if you want the optional browser switch and completion alerts.

1. If you are viewing the project on GitHub, choose **Code → Download ZIP**. In **Downloads**, right-click the ZIP and choose **Extract All… → Extract**. If someone gave you the project folder directly, open that folder in File Explorer.
2. Open the folder that contains [setup.ps1](./setup.ps1), [vibe-sync.ps1](./vibe-sync.ps1), and [start-vibe-bridge.cmd](./start-vibe-bridge.cmd). Keep the project files together.
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

## 5. Test a change from Gemini

1. Open [PROMPT.md](./PROMPT.md). Copy the entire block under **Message to paste** into a new Gemini chat. On the first line, replace `<ProjectName>` with your practice folder’s name, then send the message. Gemini should read `repo-context.txt` and report the sentence in **hello.txt**. If it cannot find the file, wait for OneDrive to finish syncing and check the folder name and Microsoft account before continuing.
2. Send this next message. Leave browser auto-approval off if you have already installed it.

> In this practice project, create one local file named bridge-test.txt containing Bridge works! Use the apply-changes.ps1 upload workflow we agreed on. Make no other changes.

3. If Gemini shows a OneDrive confirmation, check that the action uploads **apply-changes.ps1** to **projects → VibeBridgePractice**. Select **Send** if it matches the practice request. The watcher will run the script when it arrives.
4. Check PowerShell for **Executing AI patch** and a new **[READY]** message. Open **bridge-test.txt** in the **local practice folder**. If it says **Bridge works!**, the round trip succeeded. The watcher removes the upload from OneDrive after it runs successfully.

## 6. Optional browser switch and completion alerts

You can use the whole bridge by clicking **Send** yourself. Install this part if you want Gemini completion alerts or automatic approval of OneDrive confirmation cards.

1. Install [Tampermonkey](https://www.tampermonkey.net/) for Chrome or Edge. In Chrome, open `chrome://extensions` in the address bar, choose **Details** on the Tampermonkey card, and enable **Allow User Scripts** if shown. In Edge, open `edge://extensions` and follow Tampermonkey’s browser-specific steps if the toggle is absent. [Tampermonkey permissions guide](https://www.tampermonkey.net/faq.php#Q209)
2. In File Explorer, right-click **ntu-gemini-auto-approve.user.js** and choose **Open with → Notepad**. Press **Ctrl+A**, then **Ctrl+C** to copy the entire file. If Windows hides extensions, look for **ntu-gemini-auto-approve.user** with type **JavaScript File**.
3. Click the Tampermonkey icon in the browser’s **Extensions** menu. Choose **Create a new script…**. Click inside the editor, press **Ctrl+A**, then **Ctrl+V** to replace the example text, and press **Ctrl+S**. If an older copy is already installed, replace its contents from the Tampermonkey dashboard and leave only one enabled copy.
4. Refresh the Gemini tab. The **auto-approve OneDrive** switch appears near the bottom-right and starts off. Drag it to move it. When green, it turns the already-authorized OneDrive connector back on if Gemini switches it off and clicks **Send** for OneDrive actions in that tab. Turn the widget off before intentionally switching OneDrive off in Gemini. When it turns green, your browser may ask whether to allow desktop notifications. If you want notifications with approval off, allow notifications in the Gemini site settings or turn the switch back off after granting permission.

The alert means Gemini finished its chat turn. Check PowerShell to confirm the local changes finished syncing and applying. The title flashes once a second when the browser allows it. The browser can delay alerts and title flashing in background tabs. Click inside Gemini to clear the flashing title and checkmark icon.

## Everyday use

1. Make a backup of your real project. The watcher copies a snapshot to OneDrive as soon as it starts, so check your project for passwords, access keys, and private data first. Repomix skips common build folders and looks for some secrets. To exclude specific files or folders, create a text file named **.repomixignore** in your project folder. Use Notepad’s **All files** option to save that exact name. Put one name or path per line, starting from the project folder, such as `.env` or `data/private/`. [Repomix’s security guide](https://repomix.com/guide/security)
2. Double-click **start-vibe-bridge.cmd** and paste your real project’s full folder path. For example, `C:\Users\User\Desktop\python\school\vibecodetest` uses `C:\Users\User\OneDrive - Nanyang Technological University\projects\vibecodetest` for its snapshot and uploads. Use a distinct folder name for each project and run one watcher per project.
3. Check the generated `repo-context.txt` before sharing it with Gemini. Start a new chat with [PROMPT.md](./PROMPT.md) and the real project name. Ask for one change at a time and wait for the next **[READY]** before asking for another.
4. If you edit files yourself, click the PowerShell window and press **R** to refresh `repo-context.txt` before asking Gemini to read it again. Press **Q** in that window to stop the watcher. If you quit while an upload is pending, check the OneDrive project folder for that upload before restarting.

To review a generated script **before it can run**, leave auto-approval off and press **Q** in the watcher before approving the upload. When `apply-changes.ps1` syncs to OneDrive, open it **with Notepad** and have someone you trust review it if needed. Start the watcher again only after accepting the script. To reject it, move it out of the watched folder and let OneDrive finish syncing before you restart.

If you ran an older watcher, press **Q** to stop it and start the updated script with the same local project path. It creates a fresh snapshot under `projects\<ProjectName>`. Start a new Gemini chat with the updated [PROMPT.md](./PROMPT.md) so future uploads go to that folder.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| PowerShell says it cannot find `setup.ps1` | Open the extracted folder that contains it. Type `powershell` into that File Explorer window’s address bar and retry setup. |
| The launcher says it cannot find `vibe-sync.ps1` | Open the extracted folder in File Explorer and double-click the launcher there. Keep `start-vibe-bridge.cmd` and `vibe-sync.ps1` together. |
| **OneDrive Root** shows the wrong account | Press **Q** if the watcher is running. Restart with the command below, replacing the example path with the full path copied from the NTU OneDrive folder’s address bar. |
| Gemini can read OneDrive but cannot upload | Check that OneDrive write actions are available in your Gemini app. The ability to add or read a file alone does not confirm write access. |
| Gemini says it uploaded the script but nothing changes | In File Explorer, check the matching NTU OneDrive project folder for the exact name `apply-changes.ps1`. Verify OneDrive is syncing and the watcher is open for the same project. `apply-changes.ps1.txt` will not trigger it. Enable file extensions under **View → Show → File name extensions** in Windows 11, or the **View** tab in Windows 10. |
| PowerShell saves an upload as `apply-changes.failed.ps1` or adds a date to that name | Some changes may already have been applied. Compare with your backup, then ask Gemini for a corrected upload after the files are in the state you want. If the watcher could not rename the failed upload and stopped, move `apply-changes.ps1` out of the watched folder before restarting. |
| The context is too large | Use **.repomixignore** to exclude bulky files or work on a smaller folder. Press **R** and wait for OneDrive to sync. Google lists a 7 MB text attachment limit, and a model’s usable context can be smaller. [Gemini file limits](https://docs.cloud.google.com/gemini/enterprise/docs/assistant-chat#upload_and_chat_about_files) |
| The browser switch is missing | Confirm that Tampermonkey and the saved script are enabled, check the browser’s userscript permission, then refresh the **Gemini Enterprise** tab. |
| The switch shows Done but there is no desktop alert | Check the Gemini site’s notification permission, Windows notification settings, and whether the browser or the system has muted the alert. |

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\vibe-sync.ps1 -OneDrivePath "C:\Users\YourName\OneDrive - Nanyang Technological University"
```

**Want to test the watcher without Gemini?** After step 4, you can use this test in place of step 5. With only the practice watcher running, copy the bridge’s [sample apply-changes.ps1](./apply-changes.ps1) into the matching OneDrive practice folder. It creates **bridge-test.txt** with the same test message and refuses to overwrite an existing file. This checks local execution and repacking. Use a fresh practice folder when you are ready to test the Gemini connector.

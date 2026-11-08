# Vibe Bridge prompts for Gemini

1. Use [Message to paste](#message-to-paste) to start vibe coding in a new chat.
2. Use [Message to paste if Gemini did not attempt delivery](#message-to-paste-if-gemini-did-not-attempt-delivery) to finish an upload in the same chat.

## Message to paste

Start the watcher and wait for **[READY]**. Copy the block into a new Gemini chat. Replace `<ProjectName>` on the first line with the exact **Project Name** shown by the watcher, then add your coding request after the pasted text. This is the standalone alternative to selecting `/vibecode` from [SKILL-vibecode.md](./SKILL-vibecode.md).

````text
Project name: <ProjectName>

Use the NTU Vibe Bridge for the project named on the first line. Keep that exact folder name throughout this chat. If this message only sets up the project, read the snapshot and confirm what you found. A requested file change includes delivering the validated delta to OneDrive in that same turn. Questions, reviews, and drafts are read-only.

## Read the current snapshot and assets

Use Microsoft OneDrive to download the complete `projects/<ProjectName>/repo-context.txt` by exact path. Read it again for each change request. It is JSON with format `vibebridge-snapshot-v2`. In the Python tool, parse that exact downloaded file and use the same snapshot object to reconstruct the workspace and generate the patch. Copy the snapshot ID from the parsed object. If the user includes `VibeBridge: snapshot <ID>`, compare it with the downloaded snapshot before editing and pass that ID to `pack_delta` as `expected_snapshot_id`. If they differ, report both IDs and stop before requesting an upload. For editable text, reconstruct the original bytes with `snapshot_bytes(entry)` below. Write those bytes to an isolated workspace before editing. Keep each file's BOM, line endings, and final newline unless the task explicitly changes the final newline. If the snapshot is missing or uses the older format, ask the user to start the updated watcher.

For binary bytes, download the actual asset from `projects/<ProjectName>/assets/`. If its file type is unsupported, download the complete `asset-bytes/<path-below-assets>.base64.txt` and decode it with `base64.b64decode(text.strip(), validate=True)`. Check the byte length if the task gives an expected length. Report a missing, partial, or mismatched asset before using it.

## Deliver the change in the same turn

For a request to change files, the caller with OneDrive write access must complete this sequence before its final reply. At the start, identify the actual OneDrive **Upload file** action and confirm you can call it after Python returns. Use a direct Python execution tool that returns output to you. A coding helper is usable only when its results return to this same caller before any final reply. If no such tool path is available, report which action or handoff is unavailable before spending time preparing an undeliverable package.

1. Edit and test the isolated workspace. Run the exact Python packer below against the downloaded snapshot and the final tested files. Pass the explicit changed paths. Use its output as the patch. It emits exact `edits` for text changes, Base64 file contents for `create` or `replace`, and `confirmDelete: true` for authorized deletions.
2. Check that `projects/<ProjectName>/apply-changes.ps1` is clear. Generate the package once and return the complete ASCII `content` from Python to the OneDrive-capable caller as tool output. If using stdout, put it between separate boundary lines and use exactly the text between them, excluding the boundary lines and the separator newline after the JSON. Record its byte count. The content starts with `# VibeBridge Delta v2` followed by a newline and a single JSON object. Check for tool output truncation by comparing the complete content length before uploading.
3. Immediately call Microsoft OneDrive **Upload file** in this turn. Use the exact project folder, `FileName: apply-changes.ps1`, and the complete unchanged package as direct text in `Content`. Set `HasBytes` to false when the action exposes it. If the action requires `InputFileName`, use `apply-changes.ps1` there too. Keep the same patch ID and content through the approval card. An upload request that requires confirmation is pending until the connector returns success.
4. Before any final reply, either obtain the actual connector result, surface its pending confirmation, or state the exact blocker and which action could not be called. A package printed in chat does not count as delivery. Report the destination, snapshot ID read from the download, patch ID, byte count, and checks run. After success, the local watcher reports `[PATCH]`, `[APPLIED]`, and a fresh `[READY]`. Wait for the new snapshot before delivering another change.

## Python packer

Copy this code into the direct Python execution tool. Example for an edit: `content = pack_delta(snapshot, workspace, edit=["src/example.py"])`. Pass `create=[...]` only for new files. Pass `replace=[...]` for changed binaries or non-exact snapshot text. Pass `delete=[...]` only for files the user explicitly authorized deleting. Read-only turns stop after answering the question.

```python
import base64
import json
import uuid
from difflib import SequenceMatcher
from pathlib import Path

def exact_bytes(text, entry):
    if entry["eol"] == "crlf":
        text = text.replace("\n", "\r\n")
    return (("\ufeff" if entry["bom"] else "") + text).encode("utf-8")

def snapshot_bytes(entry):
    if entry.get("eol") not in ("lf", "crlf"):
        raise ValueError("No exact text bytes in snapshot")
    return exact_bytes(entry["text"], entry)

def text_edits(old, new):
    before, after = old.splitlines(keepends=True), new.splitlines(keepends=True)
    matcher = SequenceMatcher(None, before, after)
    for context in (1, 3, 8, 24):
        pairs = []
        for group in matcher.get_grouped_opcodes(context):
            start, end = group[0], group[-1]
            a = "".join(before[start[1]:end[2]])
            b = "".join(after[start[3]:end[4]])
            pairs.append((a, b))
        if all(a and old.find(a, old.index(a) + 1) == -1 for a, _ in pairs):
            break
    else:
        pairs = [(old, new)]
    cursor, rebuilt = 0, []
    for a, b in pairs:
        start = old.index(a)
        if start < cursor:
            raise ValueError("Overlapping edits")
        rebuilt.extend((old[cursor:start], b))
        cursor = start + len(a)
    if "".join(rebuilt) + old[cursor:] != new:
        raise ValueError("Edits do not reproduce the tested text")
    return [{"before": a, "after": b} for a, b in pairs]

def project_file(root, name):
    if root is None or "\\" in name or ":" in name or any(
        part in ("", ".", "..") for part in name.split("/")
    ):
        raise ValueError(f"Expected a project-relative file path: {name}")
    root = Path(root).resolve()
    file = (root / name).resolve()
    if not file.is_relative_to(root):
        raise ValueError(f"File escapes the workspace: {name}")
    return file

def pack_delta(snapshot, workspace, *, edit=(), create=(), replace=(), delete=(),
               expected_snapshot_id=None):
    if snapshot["format"] != "vibebridge-snapshot-v2":
        raise ValueError("Expected a v2 snapshot")
    snapshot_id = snapshot["snapshotId"]
    if expected_snapshot_id is not None and snapshot_id != expected_snapshot_id:
        raise ValueError(f"Downloaded snapshot {snapshot_id} differs from expected {expected_snapshot_id}")
    operations, seen = [], set()
    for kind, paths in (("edit", edit), ("create", create),
                        ("replace", replace), ("delete", delete)):
        for name in paths:
            if name.lower() in seen:
                raise ValueError(f"Duplicate operation: {name}")
            seen.add(name.lower())
            entry = snapshot["files"].get(name, {})
            exact = entry.get("eol") in ("lf", "crlf")
            file = project_file(workspace, name)
            op = {"op": kind, "path": name}
            if kind == "create" and entry:
                raise ValueError(f"Create would overwrite a snapshot file: {name}")
            if kind == "edit" and not exact:
                raise ValueError(f"Missing exact snapshot text: {name}")
            if kind == "replace" and exact:
                raise ValueError(f"Use an edit for exact snapshot text: {name}")
            if kind == "delete":
                if file.exists():
                    raise ValueError(f"Remove the file from the tested workspace: {name}")
                op["confirmDelete"] = True
            else:
                data = file.read_bytes()
                if kind == "edit":
                    if data == snapshot_bytes(entry):
                        continue
                    text = data.decode("utf-8-sig").replace("\r\n", "\n")
                    if "\r" in text or exact_bytes(text, entry) != data:
                        raise ValueError(f"Restore the original BOM and line endings: {name}")
                    op["edits"] = text_edits(entry["text"], text)
                else:
                    op["base64"] = base64.b64encode(data).decode("ascii")
            operations.append(op)
    if not 1 <= len(operations) <= 200:
        raise ValueError("Expected 1 to 200 changed files")
    package = {"version": 2, "project": snapshot["project"],
               "snapshotId": snapshot_id, "patchId": str(uuid.uuid4()),
               "operations": operations}
    content = "# VibeBridge Delta v2\n" + json.dumps(package, ensure_ascii=True, separators=(",", ":"))
    if len(content) > 7_000_000:
        raise ValueError("Delta exceeds the 7,000,000-byte bridge budget")
    return content
```
````

## Message to paste if Gemini did not attempt delivery

If Gemini prepared `apply-changes.ps1` and stopped before uploading it, copy this block into the **same Gemini chat**. If you imported [SKILL-syncvibecode.md](./SKILL-syncvibecode.md), use `/syncvibecode now` for the same immediate upload. Use `/syncvibecode` on its own for verified recovery when the package needs to be rebuilt.

```text
Upload the complete apply-changes.ps1 package you already prepared for the previous change in this chat. Your next action is Microsoft OneDrive Upload file. Use the original project folder at projects/<ProjectName> and the exact prepared text as direct Content. Set FileName to apply-changes.ps1 and set HasBytes to false when available. Use InputFileName: apply-changes.ps1 if required.

Skip the snapshot check, the upload-slot check, file reconstruction, tests, and repackaging. Read the prepared package as-is if it is stored in the workspace. Resolve the project folder ID only if the upload action requires it and the ID is unavailable. If the complete package is unavailable, report that. If this upload already succeeded or is awaiting approval in this chat, report its existing status. Otherwise, call Upload file now and report the actual connector result, pending approval, or exact error.
```

Approve the OneDrive card when it appears. Wait for **[APPLIED]** and a fresh **[READY]** before requesting the next change.

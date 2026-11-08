# Vibe Bridge prompts for Gemini

1. Use [Message to paste](#message-to-paste) to start vibe coding in a new chat.
2. Use [Message to paste if Gemini did not attempt delivery](#message-to-paste-if-gemini-did-not-attempt-delivery) to finish an upload in the same chat.

## Message to paste

Start the watcher and wait for **[READY]**. Copy the block into a new Gemini chat. Replace `<ProjectName>` on the first line with the exact **Project Name** shown by the watcher, then add your coding request after the pasted text. This is the standalone alternative to selecting `/vibecode` from [vibecode.zip](./vibecode.zip).

````text
Project name: <ProjectName>

Use the NTU Vibe Bridge for the project named on the first line. Keep that exact folder name throughout this chat. If this message only sets up the project, read the snapshot and confirm what you found. A requested file change includes delivering the validated delta to OneDrive in that same turn. Questions, reviews, and drafts are read-only.

## Read the current snapshot and assets

Use Microsoft OneDrive to download the complete `projects/<ProjectName>/repo-context.txt` by exact path. Use a direct OneDrive lookup and download. Reuse any project folder or drive ID returned for that exact path when the upload needs it. If the exact lookup fails, report the path and connector error. Use the active skill or supplied prompt. Use only exact project paths for OneDrive lookups and load the recovery skill only for an explicit recovery request. Read the snapshot again for each change request. It is JSON with format `vibebridge-snapshot-v2`. In the Python tool, parse that exact downloaded file and use the same snapshot object to reconstruct the workspace and generate the patch. Copy the snapshot ID from the parsed object. If the user includes `VibeBridge: snapshot <ID>`, compare it with the downloaded snapshot before editing and pass that ID to `pack_delta` as `expected_snapshot_id`. If they differ, report both IDs and stop before requesting an upload. For editable text, reconstruct the original bytes with `snapshot_bytes(entry)` below. Write those bytes to an isolated workspace before editing. Keep each file's BOM, line endings, and final newline unless the task explicitly changes the final newline. If the snapshot is missing or uses the older format, ask the user to start the updated watcher.

For binary bytes, download the actual asset from `projects/<ProjectName>/assets/`. If its file type is unsupported, download the complete `asset-bytes/<path-below-assets>.base64.txt` and decode it with `base64.b64decode(text.strip(), validate=True)`. Check the byte length if the task gives an expected length. Report a missing, partial, or mismatched asset before using it.

## Deliver the change in the same turn

Keep control with the caller that has the registered Microsoft OneDrive **Upload file** action. Before editing, confirm that this same caller can run Python directly and then call **Upload file**. For a small task, run Python directly in that caller. Delegate only through a real tool that returns the complete result to this caller in the same turn. If the necessary tool path is unavailable, report the exact blocker before editing. A printed transfer marker or tool-call snippet is chat text.

1. Edit and test the isolated workspace. Run the exact Python packer below against the downloaded snapshot and the final tested files. Pass the explicit changed paths. Use its output as the patch. It emits exact `edits` for text changes and `confirmDelete: true` for authorized deletions. A `create` operation uses either a `text` string for UTF-8 or a `base64` string for exact bytes. Supply one field per operation. Replacements use `base64`.
2. Check the exact `projects/<ProjectName>/apply-changes.ps1` path once and upload only if the slot is clear. Use the exact `pack_delta()` return value and save the ASCII package as `vibebridge-<patchId>.txt` in the isolated workspace. Record the byte count. Return the complete text to the OneDrive-capable caller through tool output if needed for direct upload. If stdout is the only route, use separate boundary lines, exclude the boundaries and separator newline from the package, and compare its length to detect truncation. Run `validate_delta_envelope(content, project)` on the exact content before delivery. Keep source and payload text in tools.
3. Immediately invoke the registered Microsoft OneDrive **Upload file** action in this turn using the method below.
4. Before any final reply, either obtain the actual connector result, surface its pending confirmation, or state the exact blocker and which action could not be called. Reply with a short summary of changes, checks, destination, snapshot ID, patch ID, byte count, and upload status. Keep full source, Base64, and patch text out of the visible reply. After success, the local watcher reports `[PATCH]`, `[APPLIED]`, and a fresh `[READY]`. Wait for the new snapshot before delivering another change.

## OneDrive upload method

1. Call the registered Microsoft OneDrive **Upload file** action using direct `Content` by default. Use the exact ASCII delta returned by the packer or read from the retained file. Set `FileName` to `apply-changes.ps1`, `HasBytes` to false when available, and `InputFileName` to `apply-changes.ps1` if required. The filename is the watcher's inbox convention. The body is delta data.
2. If the user explicitly requests a file reference and the exact validated package is available as a connector-visible attachment, set `InputFileName` to its actual attachment name and leave `Content` and `ContentBytes` unset. A Python workspace filename alone is insufficient. If the reference is unavailable or explicitly fails before writing, use the exact package as direct `Content`.
3. Count an upload as requested when the real connector responds or displays its approval card. If the outcome is uncertain, report it and stop. Keep tool markup, source, and package text out of the visible reply.

## Python packer

Copy this code into the direct Python execution tool. Example for an edit: `content = pack_delta(snapshot, workspace, edit=["src/example.py"])`. Pass `create=[...]` only for new files. Pass `replace=[...]` for changed binaries or non-exact snapshot text. Pass `delete=[...]` only for files the user explicitly authorized deleting. Call `validate_delta_envelope(content, project)` on the exact text before upload. Read a retained file with `Path.read_bytes().decode("ascii")` to preserve its line endings. Read-only turns stop after answering the question.

```python
import base64
import json
import uuid
from difflib import SequenceMatcher
from pathlib import Path

DELTA_HEADER = "# VibeBridge Delta v2"
PATCH_LIMIT = 7_000_000


def validate_delta_envelope(content, project):
    """Read delta metadata without rewriting the text used for upload."""
    if not isinstance(content, str) or not content.isascii() or len(content) > PATCH_LIMIT:
        raise ValueError("Expected an ASCII delta within the bridge size limit")
    header, newline, body = content.partition("\n")
    if not newline or header not in (DELTA_HEADER, DELTA_HEADER + "\r"):
        raise ValueError("Expected the VibeBridge Delta v2 header")

    def reject_constant(value):
        raise ValueError(f"Invalid JSON constant in delta: {value}")

    package = json.loads(body, parse_constant=reject_constant)
    if not isinstance(package, dict) or package.get("version") != 2:
        raise ValueError("Expected a Delta v2 JSON object")
    if package.get("project") != project:
        raise ValueError("Delta project does not match the destination")
    for key in ("snapshotId", "patchId"):
        value = package.get(key)
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError(f"Expected a canonical delta {key}")
    operations = package.get("operations")
    if not isinstance(operations, list) or not 1 <= len(operations) <= 200:
        raise ValueError("Expected 1 to 200 delta operations")
    return package

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
                    text = None
                    if kind == "create" and b"\0" not in data:
                        try:
                            text = data.decode("utf-8")
                        except UnicodeDecodeError:
                            pass
                    if text is None:
                        op["base64"] = base64.b64encode(data).decode("ascii")
                    else:
                        op["text"] = text
            operations.append(op)
    if not 1 <= len(operations) <= 200:
        raise ValueError("Expected 1 to 200 changed files")
    package = {"version": 2, "project": snapshot["project"],
               "snapshotId": snapshot_id, "patchId": str(uuid.uuid4()),
               "operations": operations}
    content = DELTA_HEADER + "\n" + json.dumps(package, ensure_ascii=True, separators=(",", ":"))
    if len(content) > PATCH_LIMIT:
        raise ValueError("Delta exceeds the 7,000,000-byte bridge budget")
    return content
```
````

## Message to paste if Gemini did not attempt delivery

If Gemini prepared `apply-changes.ps1` and stopped before uploading it, copy this block into the **same Gemini chat**. If you imported [syncvibecode.zip](./syncvibecode.zip), use `/syncvibecode now` for the same immediate upload. Use `/syncvibecode` on its own for verified recovery when the package needs to be rebuilt.

```text
Retrieve the exact delta prepared for the previous change. In Python, read the exact text as ASCII and validate it with validate_delta_envelope(content, project) from the start prompt, or check the same fields directly in Python if the helper is unavailable. It must have the VibeBridge Delta v2 header and a JSON object with version 2, the exact project, snapshotId, patchId, and operations. If the package is missing or malformed, report that blocker and suggest plain /syncvibecode for verified recovery.

Skip snapshot and slot checks, file reconstruction, tests, and repackaging. Resolve the original project folder by exact path only if its ID is required and unavailable. If an earlier upload succeeded, is pending approval, or has an uncertain outcome, report its status.

Call the registered OneDrive Upload file action with the exact retained package as direct Content. Keep the patch ID, set FileName to apply-changes.ps1, and set HasBytes to false when available. Use apply-changes.ps1 as InputFileName if required. Reply with the connector result, pending approval, or exact blocker. Keep tool markup, source, and package text out of the visible reply.
```

Approve the OneDrive card when it appears. Wait for **[APPLIED]** and a fresh **[READY]** before requesting the next change.

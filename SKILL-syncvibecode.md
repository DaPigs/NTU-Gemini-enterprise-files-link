---
name: syncvibecode
description: Finish a previously requested Vibe Bridge upload through Microsoft OneDrive. Use syncvibecode now to upload the prepared package immediately, or syncvibecode for verified recovery.
---

# Finish a Vibe Bridge upload

Use this skill in the same chat after a `/vibecode` or standalone Vibe Bridge coding turn that prepared a user-authorized change and stopped before delivery. Use the exact project and pending change from that turn. If either is ambiguous, ask for the missing information. If this chat already shows a successful upload or pending confirmation for that change, report its existing status.

## Immediate upload with `/syncvibecode now`

Use this mode when the user types `now` after the skill mention. Take the complete `apply-changes.ps1` package already prepared for the previous change and call Microsoft OneDrive **Upload file** immediately. Read the existing package as-is if it is stored in the workspace. If the complete package is unavailable, report that blocker and stop.

Use the original project folder at `projects/<ProjectName>`, `FileName: apply-changes.ps1`, and the exact existing text as direct `Content`. Set `HasBytes: false` when available and use `InputFileName: apply-changes.ps1` if required. Resolve the project folder ID only if the upload action requires it and the ID is unavailable.

Skip downloading or comparing `repo-context.txt`, checking whether the upload slot is clear, parsing the package, reconstructing files, running tests, and running `pack_delta()`. Use the package as it was prepared. Report the actual connector result, pending confirmation, or exact error, then stop. The watcher validates the upload when it arrives.

## Verified recovery with `/syncvibecode`

Use this workflow when the user invokes the skill without `now`. Identify the original snapshot ID and requested files from the previous change. If either is ambiguous, ask for the missing information.

## Check the destination and snapshot

- Download the current `projects/<ProjectName>/repo-context.txt` by exact path. Parse it in Python. Require the project name and `snapshotId` to match the snapshot used for the tested change. If the ID has changed, report both IDs and ask the user to request a new patch against the fresh snapshot.
- Resolve the exact OneDrive project folder and check `projects/<ProjectName>/apply-changes.ps1` before uploading. If it already exists or the lookup fails for a reason other than the file being absent, report that status and stop.

## Recover and deliver the tested patch

1. Keep the work with the caller that can invoke Microsoft OneDrive **Upload file**. Reuse the complete verified Delta v2 text if it is available and matches the current project, original snapshot, and the requested files. Keep its original patch ID and text. The header is `# VibeBridge Delta v2`. The JSON uses `version: 2`, `snapshotId`, `patchId`, and `operations`. An edit uses `edits` with `before` and `after` strings. A create or replacement uses a `base64` string containing the complete file bytes.
2. If the previous package is missing or malformed, recover the previously tested file bytes in an isolated workspace. Use the direct Python tool to run the packer below on those files and pass the original ID as `expected_snapshot_id`. Include only the previous change. If the tested bytes cannot be recovered, report which artifact is missing.
3. Return the complete ASCII package from Python to the OneDrive-capable caller. Check the byte count to catch truncated tool output. Immediately invoke **Upload file** in this turn. Use `FileName: apply-changes.ps1` and the exact package as direct text in `Content`. Use `HasBytes: false` and `InputFileName: apply-changes.ps1` when the action exposes or requires those fields. Keep the exact package and patch ID through approval.
4. Report the actual connector result, pending confirmation, or exact blocker. Include the destination, snapshot ID, patch ID, and size when available. Local application is confirmed by the watcher’s **[APPLIED]** and **[READY]** messages.

## Python packer

Use `pack_delta(snapshot, workspace, edit=[...], expected_snapshot_id=original_snapshot_id)` for exact text edits. Supply `create` for previously requested new files and `replace` for binary or non-exact text changes. Supply `delete` only for files the user explicitly asked to remove.

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

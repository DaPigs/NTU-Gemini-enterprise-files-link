---
name: syncvibecode
description: Finish a previously requested Vibe Bridge change in the same chat by uploading its verified delta through Microsoft OneDrive when the coding turn stops before delivery.
---

# Finish a Vibe Bridge upload

When the user invokes `/syncvibecode` by itself in the same chat after a `/vibecode` or standalone Vibe Bridge coding turn that prepared a change and stopped before delivery, resume the most recent user-authorized, tested change for the active project. Resolve the exact project name, original snapshot ID, and requested files from that turn. If the project, snapshot, or pending change is ambiguous, ask for the missing information. A previous read-only request has no change to deliver.

## Check the destination and snapshot

- If the last upload is pending approval, direct the user to its existing confirmation card. If it already succeeded, report that result and ask the user to check the watcher for **[APPLIED]** and **[READY]**.
- Download the current `projects/<ProjectName>/repo-context.txt` by exact path. Parse it in Python. Require the project name and `snapshotId` to match the snapshot used for the tested change. If the ID has changed, report both IDs and ask the user to request a new patch against the fresh snapshot.
- Resolve the exact OneDrive project folder and check `projects/<ProjectName>/apply-changes.ps1` before uploading. If it already exists or the lookup fails for a reason other than the file being absent, report that status and stop.

## Recover and deliver the tested patch

1. Keep the work with the caller that can invoke Microsoft OneDrive **Upload file**. Reuse the complete verified Delta v2 text if it is available and matches the current project, original snapshot, and the requested files. Compare its patch ID, target file hashes, and package hash with any recorded values. The header is `# VibeBridge Delta v2`. The JSON uses `version: 2`, `snapshotId`, `patchId`, and `operations`. An edit uses `baseSha256`, `sha256`, and `edits` with `before` and `after` strings.
2. If the previous package is missing or malformed, recover the previously tested file bytes in an isolated workspace and compare them with the recorded target hashes when available. Use the direct Python tool to run the packer below on those files and pass the original ID as `expected_snapshot_id`. Include only the previous change. If the tested bytes cannot be recovered and verified, report which artifact is missing.
3. Return the complete ASCII package from Python to the OneDrive-capable caller. Verify that the bytes and SHA-256 match the package you are about to send. Immediately invoke **Upload file** in this turn. Use `FileName: apply-changes.ps1` and the exact package as direct text in `Content`. Use `HasBytes: false` and `InputFileName: apply-changes.ps1` when the action exposes or requires those fields. Keep the exact package, patch ID, and hash through approval.
4. Report the actual connector result, pending confirmation, or exact blocker. Include the destination, snapshot ID, patch ID, size, and package hash when available. Local application is confirmed by the watcher’s **[APPLIED]** and **[READY]** messages.

## Python packer

Use `pack_delta(snapshot, workspace, edit=[...], expected_snapshot_id=original_snapshot_id)` for exact text edits. Supply `create` for previously requested new files and `replace` for binary or non-exact text changes. For `replace` or `delete` without exact snapshot bytes, `originals` must point to a separate folder containing the actual original files at their project-relative paths. Supply `delete` only for files the user explicitly asked to remove.

```python
import base64
import hashlib
import json
import uuid
from difflib import SequenceMatcher
from pathlib import Path

def sha(data):
    return hashlib.sha256(data).hexdigest()

def exact_bytes(text, entry):
    if entry["eol"] == "crlf":
        text = text.replace("\n", "\r\n")
    return (("\ufeff" if entry["bom"] else "") + text).encode("utf-8")

def snapshot_bytes(entry):
    if entry.get("eol") not in ("lf", "crlf") or not entry.get("sha256"):
        raise ValueError("No exact text bytes in snapshot")
    data = exact_bytes(entry["text"], entry)
    if sha(data) != entry["sha256"]:
        raise ValueError("Snapshot bytes do not match their SHA-256")
    return data

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
               originals=None, expected_snapshot_id=None):
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
            exact = entry.get("eol") in ("lf", "crlf") and bool(entry.get("sha256"))
            file = project_file(workspace, name)
            op = {"op": kind, "path": name}
            if kind == "create" and entry:
                raise ValueError(f"Create would overwrite a snapshot file: {name}")
            if kind == "edit" and not exact:
                raise ValueError(f"Missing exact snapshot text: {name}")
            if kind == "replace" and exact:
                raise ValueError(f"Use an edit for exact snapshot text: {name}")
            if kind != "create":
                base = snapshot_bytes(entry) if exact else project_file(originals, name).read_bytes()
                op["baseSha256"] = sha(base)
            if kind == "delete":
                if file.exists():
                    raise ValueError(f"Remove the file from the tested workspace: {name}")
                op["confirmDelete"] = True
            else:
                data = file.read_bytes()
                if kind != "create" and data == base:
                    continue
                op["sha256"] = sha(data)
                if kind == "edit":
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

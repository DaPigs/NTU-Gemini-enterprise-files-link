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

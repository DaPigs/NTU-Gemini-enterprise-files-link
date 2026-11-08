"""Rebuild the Gemini skill ZIPs with the current shared Python helper."""

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
FENCE = chr(96) * 3


def inline_packer(markdown):
    return markdown.split(FENCE + "python\n", 1)[1].split("\n" + FENCE, 1)[0] + "\n"


def build(output):
    helper = ROOT / "scripts" / "pack_delta.py"
    source = helper.read_text(encoding="utf-8")
    prompt = (ROOT / "PROMPT.md").read_text(encoding="utf-8")
    if source != inline_packer(prompt):
        raise ValueError("Bundled and inline packers differ")
    skills = {}
    for name in ("vibecode", "syncvibecode"):
        with ZipFile(ROOT / f"{name}.zip") as archive:
            skills[name] = archive.read(f"{name}/SKILL.md")
    output.mkdir(parents=True, exist_ok=True)
    for name, markdown in skills.items():
        path = output / f"{name}.zip"
        with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr(f"{name}/SKILL.md", markdown)
            archive.write(helper, f"{name}/scripts/pack_delta.py")
        print(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="directory for the two skill ZIPs")
    build(parser.parse_args().output)


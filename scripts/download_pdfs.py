"""Mirror the public source site's PDF attachments without executing its code."""
import concurrent.futures
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://4kqzd0m8f7y5w.aiforce.cloud/app/app_17b6n690wyg"
CASES = json.loads((ROOT / "data/cases.json").read_text())
PATHS = sorted({r["url"] for c in CASES for r in c.get("resources", [])
                if r.get("url", "").startswith("/pdfs/")})


def download(path):
    destination = ROOT / "docs" / path.lstrip("/")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.read_bytes()[:5] == b"%PDF-" and b"%%EOF" in destination.read_bytes()[-4096:]:
        return {"path": path, "bytes": destination.stat().st_size, "ok": True}
    temporary = destination.with_suffix(".download")
    for range_options in [["--range", "0-"], []]:
        result = subprocess.run(
            ["curl", "--silent", "--show-error", "--fail", "--location",
             "--connect-timeout", "8", "--max-time", "60", "--retry", "2",
             "--retry-delay", "1", *range_options, "--output", str(temporary), SOURCE + path],
            capture_output=True, text=True)
        valid = result.returncode == 0 and temporary.exists() and temporary.read_bytes()[:5] == b"%PDF-" and b"%%EOF" in temporary.read_bytes()[-4096:]
        if valid:
            temporary.replace(destination)
            return {"path": path, "bytes": destination.stat().st_size, "ok": True}
    temporary.unlink(missing_ok=True)
    return {"path": path, "ok": False, "error": result.stderr[-240:]}


if __name__ == "__main__":
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for record in executor.map(download, PATHS):
            records.append(record)
            if len(records) % 25 == 0:
                print(f"Checked {len(records)}/{len(PATHS)} PDFs; downloaded {sum(r['ok'] for r in records)}", flush=True)
    (ROOT / "data/pdf-download-report.json").write_text(json.dumps(records, ensure_ascii=False, indent=2))
    print(json.dumps({"total": len(records), "downloaded": sum(r["ok"] for r in records),
                      "bytes": sum(r.get("bytes", 0) for r in records),
                      "failed": [r["path"] for r in records if not r["ok"]]}, ensure_ascii=False), flush=True)

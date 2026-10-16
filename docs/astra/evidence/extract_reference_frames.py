"""Reproduce reviewed samples from local original MP4s. No downloads or API keys."""
from pathlib import Path
import json, subprocess, hashlib
repo=Path(__file__).resolve().parents[3]
manifest=repo/'data/astra/evidence-sources.jsonl'
for line in manifest.read_text().splitlines():
    row=json.loads(line); source=Path(row['source'])
    if not source.exists():
        print(row['id'], 'SOURCE_MISSING'); continue
    if hashlib.sha256(source.read_bytes()).hexdigest()!=row['sha256']:
        raise ValueError('SOURCE_HASH_MISMATCH: '+row['id'])
    out=repo/'tmp/astra-reference-frames'/row['id']; out.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg','-v','error','-i',str(source),'-vf','fps=1/10','-q:v','2','-threads','1','-strict','unofficial',str(out/'%05d.jpg')],check=True)
    print(row['id'], 'sampled at 10 seconds; extraction is not inspection')

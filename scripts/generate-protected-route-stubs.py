#!/usr/bin/env python3
from pathlib import Path

ROUTES = [
    "press",
    "polls",
    "entry/submit",
    "entry/messages",
    "entry/achievements",
    "entry/pressroom",
    "entry/2-organs-midori-ataka",
    "entry/aidan-yeats",
    "entry/amplified-knives-tyler-jordan",
    "entry/amplified-printer",
    "entry/amplified-tv-sam-pluta",
    "entry/anant-shah",
    "entry/andrew-chanover",
    "entry/as-though-im-slipping",
    "entry/bassoon-and-electronics",
    "entry/bojun-zhang",
    "entry/cello-emmanuel-losa",
    "entry/cybernetic-scat-paul-hermansen",
    "entry/electric-guitar-chris-mann",
    "entry/electric-guitar-pedals-ethan-bailey-gould",
    "entry/hammered-dulcimer-cameron-church",
    "entry/multiperc",
    "entry/no-input-mixer-jared-murphy",
    "entry/prepared-bass-viol-suarez-solis",
    "entry/prepared-harpsichord-suarez-solis",
    "entry/prepared-oboe-sky-macklay",
    "entry/sebastian-suarez-solis",
    "entry/splinterings-jakob-heinemann",
    "entry/this-is-a-tangible-space",
    "entry/tim-feeney",
    "entry/voice-everyday-object-manipulation-levi-lu",
]

STUB = """<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>Dex — Protected (Dev Stub)</title>
  <script defer src=\"/assets/vendor/auth0-spa-js.umd.min.js\"></script>
  <script defer src=\"/assets/dex-auth0-config.js\"></script>
  <script defer src=\"/assets/dex-auth.js\"></script>
</head>
<body></body>
</html>
"""

for route in ROUTES:
    p = Path(route) / "index.html"
    if p.exists():
        continue
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(STUB, encoding="utf-8")
    print(f"created {p}")

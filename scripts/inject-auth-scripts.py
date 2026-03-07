#!/usr/bin/env python3
import re
from pathlib import Path

AUTH0_SCRIPT = '<script defer src="/assets/vendor/auth0-spa-js.umd.min.js"></script>'
CFG_SCRIPT = '<script defer src="/assets/dex-auth0-config.js"></script>'
AUTH_SCRIPT = '<script defer src="/assets/dex-auth.js"></script>'
BLOCK = f"  {AUTH0_SCRIPT}\n  {CFG_SCRIPT}\n  {AUTH_SCRIPT}\n"

SCRIPT_PATTERNS = [
    re.compile(r"\s*<script[^>]*src=\"[^\"]*auth0-spa-js[^\"]*\"[^>]*></script>\s*", re.IGNORECASE),
    re.compile(r"\s*<script[^>]*src=\"/assets/vendor/auth0-spa-js\.umd\.min\.js\"[^>]*></script>\s*", re.IGNORECASE),
    re.compile(r"\s*<script[^>]*src=\"/assets/dex-auth0-config\.js\"[^>]*></script>\s*", re.IGNORECASE),
    re.compile(r"\s*<script[^>]*src=\"/assets/dex-auth-config\.js\"[^>]*></script>\s*", re.IGNORECASE),
    re.compile(r"\s*<script[^>]*src=\"/assets/dex-auth\.js\"[^>]*></script>\s*", re.IGNORECASE),
]

for p in Path('.').rglob('*.html'):
    if 'node_modules' in p.parts or '.git' in p.parts:
        continue
    original = p.read_text(encoding='utf-8')
    text = original
    for pattern in SCRIPT_PATTERNS:
      text = pattern.sub('\n', text)

    if re.search(r"</head>", text, re.IGNORECASE):
        text = re.sub(r"</head>", BLOCK + "</head>", text, count=1, flags=re.IGNORECASE)

    text = re.sub(r"\n{3,}", "\n\n", text)
    if text != original:
        p.write_text(text, encoding='utf-8')
        print(f"updated {p}")

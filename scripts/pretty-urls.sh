#!/usr/bin/env bash
set -euo pipefail

PUBLISH_DIR="${PUBLISH_DIR:-docs}"
BASE_PATH="${BASE_PATH:-/}"

# normalize BASE_PATH to "/something" with trailing slash
if [[ "$BASE_PATH" == "/" ]]; then
  BASE_HREF="/"
else
  BASE_HREF="${BASE_PATH%/}/"
fi

# 1) duplicate every *.html into */index.html (except existing index.html)
find "$PUBLISH_DIR" -type f -name '*.html' ! -name 'index.html' ! -name '404.html' -print0 | while IFS= read -r -d '' f; do
  dir="$(dirname "$f")"
  name="$(basename "$f" .html)"
  pretty_dir="$dir/$name"
  pretty_index="$pretty_dir/index.html"

  mkdir -p "$pretty_dir"
  cp -f "$f" "$pretty_index"

  # inject <base href="..."> right after the first <head...> if not present
  if ! grep -qi '<base[[:space:]]' "$pretty_index"; then
    python3 - "$pretty_index" "$BASE_HREF" <<'PY'
import sys, re
path, base = sys.argv[1], sys.argv[2]
s = open(path, 'r', encoding='utf-8', errors='ignore').read()

m = re.search(r'<head(\s[^>]*)?>', s, flags=re.I)
if not m:
    # no <head>; do nothing
    sys.exit(0)

ins = m.group(0) + "\n  " + f'<base href="{base}">' + "\n"
out = s[:m.start()] + ins + s[m.end():]
open(path, 'w', encoding='utf-8').write(out)
PY
  fi

  # replace original foo.html with a redirect stub to ./foo/
  cat > "$f" <<EOF
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./$name/">
<link rel="canonical" href="./$name/">
<script>location.replace("./$name/");</script>
EOF
done

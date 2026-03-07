#!/usr/bin/env python3
import sys, urllib.request, xml.etree.ElementTree as ET
from urllib.parse import urlparse

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        return r.read()

def localname(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag

def parse_sitemap(url: str, seen: set[str], out: set[str]):
    if url in seen:
        return
    seen.add(url)

    data = fetch(url)
    root = ET.fromstring(data)
    kind = localname(root.tag)

    if kind == "sitemapindex":
        for sm in root.findall(".//{*}sitemap/{*}loc"):
            loc = (sm.text or "").strip()
            if loc:
                parse_sitemap(loc, seen, out)
        return

    if kind == "urlset":
        for u in root.findall(".//{*}url/{*}loc"):
            loc = (u.text or "").strip()
            if loc:
                out.add(loc)
        return

def main():
    if len(sys.argv) < 2:
        print("usage: extract-sitemap-urls.py <sitemap-url>", file=sys.stderr)
        sys.exit(2)

    start = sys.argv[1]
    seen, out = set(), set()
    parse_sitemap(start, seen, out)

    # Keep only your site pages (avoid stray hosts if any)
    allowed = {
        "dexdsl.github.io",
        "www.dexdsl.github.io",
        "dexdsl.org",
        "www.dexdsl.org",
        "dexdsl.com",
        "www.dexdsl.com",
    }
    urls = []
    for u in out:
        h = urlparse(u).hostname or ""
        if h in allowed:
            urls.append(u)

    for u in sorted(set(urls)):
        print(u)

if __name__ == "__main__":
    main()

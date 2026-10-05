"""
Automated Publisher for ClaudeCut DEV.to Article.
Usage:
    python scripts/publish_devto.py <DEVTO_API_KEY> [--draft]
"""

import sys
import os
import httpx

DEVTO_API_URL = "https://dev.to/api/articles"
ARTICLE_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "DEV_TO_POST.md")

def publish(api_key: str, is_draft: bool = False):
    with open(ARTICLE_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    headers = {
        "api-key": api_key.strip(),
        "Content-Type": "application/json",
        "User-Agent": "ClaudeCut-Publisher/1.0"
    }

    if is_draft:
        content = content.replace("published: true", "published: false")

    payload = {
        "article": {
            "body_markdown": content
        }
    }

    print("[INFO] Publishing ClaudeCut article to DEV.to...")
    resp = httpx.post(DEVTO_API_URL, headers=headers, json=payload, timeout=30.0)

    if resp.status_code in [200, 201]:
        data = resp.json()
        print("[SUCCESS] Your article is live at:")
        print(f"URL: {data.get('url')}")
        return data.get('url')
    else:
        print(f"[ERROR] Failed ({resp.status_code}): {resp.text}")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        api_key = os.environ.get("DEVTO_API_KEY")
        if not api_key:
            print("Usage: python scripts/publish_devto.py <DEVTO_API_KEY> [--draft]")
            sys.exit(1)
    else:
        api_key = sys.argv[1]

    is_draft = "--draft" in sys.argv
    publish(api_key, is_draft=is_draft)

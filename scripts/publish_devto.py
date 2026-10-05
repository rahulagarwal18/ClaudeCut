"""
Automated Publisher for DEV.to Articles.
Usage:
    python scripts/publish_devto.py <DEVTO_API_KEY> [--draft]
"""

import sys
import os
import httpx

DEVTO_API_URL = "https://dev.to/api/articles"
ARTICLE_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "DEV_TO_POST.md")

def publish(api_key: str, article_path: str = None, is_draft: bool = False):
    target_path = article_path or ARTICLE_PATH
    with open(target_path, "r", encoding="utf-8") as f:
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

    print("[INFO] Publishing article to DEV.to...")
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
    import argparse
    parser = argparse.ArgumentParser(description="Publish Markdown post to DEV.to")
    parser.add_argument("api_key", nargs="?", default=os.environ.get("DEVTO_API_KEY"), help="DEV.to API Key")
    parser.add_argument("--file", "-f", default=ARTICLE_PATH, help="Path to markdown article")
    parser.add_argument("--draft", action="store_true", help="Publish as draft")

    args = parser.parse_args()
    if not args.api_key:
        print("Usage: python scripts/publish_devto.py <DEVTO_API_KEY> [--file path/to/article.md] [--draft]")
        sys.exit(1)

    publish(args.api_key, article_path=args.file, is_draft=args.draft)

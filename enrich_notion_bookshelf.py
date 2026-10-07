#!/usr/bin/env python3
"""
Notion 書櫃全量中繼資料與書封自動補齊腳本 (enrich_notion_bookshelf.py)
自動透過 google-books-tw-mcp 檢索臺灣出版品，補齊 Notion 書櫃中所有缺少封面與 ISBN 的書籍。
"""

import sys
import os
import re
import json
import asyncio
import time
import httpx
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

# 載入設定
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "google-books-tw-mcp")))

from server import resolve_book

NOTION_TOKEN = os.environ.get("NOTION_API_KEY", "").strip()
NOTION_DB_ID = os.environ.get("NOTION_DATABASE_ID", "45ff2f17-8ffe-4bf5-8d41-7fc0dfece19f")

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}


def clean_book_title(raw_title: str) -> str:
    """清理書名中的副標題、版本備註、贈品標籤以提高搜尋命中率"""
    if not raw_title:
        return ""
    # 去除前後空白
    t = raw_title.strip()
    # 移除括號內的非書名備註 (如：增訂版、二版、附DVD)
    t = re.sub(r"[\(（].*?[\)）]", "", t)
    # 移除書名號中的子書名或贈品
    t = re.sub(r"【.*?】", "", t)
    # 依照冒號取主標題
    parts = re.split(r"[：:]", t)
    main_title = parts[0].strip()
    return main_title if main_title else t


async def enrich_all():
    print("=" * 60)
    print("🚀 啟動 Notion「我的書櫃」全量書目與高畫質書封補全任務...")
    print(f"📦 Notion Database ID: {NOTION_DB_ID}")
    print("=" * 60)

    # 1. 讀取所有書籍
    all_pages = []
    has_more = True
    start_cursor = None
    query_url = f"https://api.notion.com/v1/databases/{NOTION_DB_ID}/query"

    while has_more:
        body = {"page_size": 100}
        if start_cursor:
            body["start_cursor"] = start_cursor
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(query_url, headers=NOTION_HEADERS, json=body)
            if resp.status_code != 200:
                print(f"❌ 查詢 Notion 資料庫失敗: {resp.status_code} {resp.text}")
                return
            data = resp.json()
            all_pages.extend(data.get("results", []))
            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")

    print(f"📚 書櫃現有書籍總數: {len(all_pages)} 本\n")

    # 2. 篩選需要補齊的書籍
    candidates = []
    for p in all_pages:
        pid = p["id"]
        props = p.get("properties", {})
        title_objs = props.get("Name", {}).get("title", [])
        title = title_objs[0].get("plain_text", "").strip() if title_objs else ""
        if not title:
            continue

        has_cover = bool(p.get("cover"))
        files = props.get("書封", {}).get("files", [])
        isbn_objs = props.get("ISBN", {}).get("rich_text", [])
        isbn = isbn_objs[0].get("plain_text", "").strip() if isbn_objs else ""
        authors = [a.get("name") for a in props.get("作者", {}).get("multi_select", [])]
        publisher = props.get("出版社", {}).get("select", {})
        pub_name = publisher.get("name") if publisher else None

        # 只要缺少封面或 ISBN，即排入補齊隊列
        if not has_cover or not files or not isbn:
            candidates.append({
                "page_id": pid,
                "raw_title": title,
                "clean_title": clean_book_title(title),
                "has_cover": has_cover and bool(files),
                "isbn": isbn,
                "authors": authors,
                "publisher": pub_name
            })

    print(f"🔍 檢索到待補齊書籍: {len(candidates)} 本\n")
    if not candidates:
        print("✨ 所有書籍中繼資料與封面皆已完整，無需補齊！")
        return

    # 3. 逐一透過 google-books-tw-mcp 補全
    success_count = 0
    fail_count = 0

    for idx, c in enumerate(candidates, 1):
        pid = c["page_id"]
        target = c["isbn"] or c["clean_title"] or c["raw_title"]
        print(f"[{idx}/{len(candidates)}] 正在處理: 《{c['raw_title']}》 (檢索詞: {target})...")

        res = await resolve_book(target)
        if not res.get("found") and c["clean_title"] != c["raw_title"]:
            # 若初次未找到，嘗試純原始書名
            res = await resolve_book(c["raw_title"])

        if res.get("found") and res.get("book"):
            b = res["book"]
            cover_url = b.get("cover", {}).get("url")
            isbn_13 = b.get("identity", {}).get("isbn_13")
            b_authors = b.get("work", {}).get("authors", [])
            b_pub = b.get("edition", {}).get("publisher")

            patch_props = {}
            if cover_url:
                patch_props["書封"] = {"files": [{"name": "cover.jpg", "type": "external", "external": {"url": cover_url}}]}
            if isbn_13 and not c["isbn"]:
                patch_props["ISBN"] = {"rich_text": [{"text": {"content": isbn_13}}]}
            if b_authors and not c["authors"]:
                patch_props["作者"] = {"multi_select": [{"name": a} for a in b_authors[:3]]}
            if b_pub and not c["publisher"]:
                patch_props["出版社"] = {"select": {"name": b_pub}}

            patch_body = {"properties": patch_props}
            if cover_url:
                patch_body["cover"] = {"type": "external", "external": {"url": cover_url}}

            async with httpx.AsyncClient(timeout=10.0) as client:
                patch_resp = await client.patch(
                    f"https://api.notion.com/v1/pages/{pid}",
                    headers=NOTION_HEADERS,
                    json=patch_body
                )

                if patch_resp.status_code == 200:
                    success_count += 1
                    print(f"  ✅ 補全成功！封面: {'已載入' if cover_url else '無'} | ISBN: {isbn_13 or '維持'} | 出版社: {b_pub or '維持'}")
                else:
                    fail_count += 1
                    print(f"  ❌ Notion 寫入失敗: {patch_resp.status_code}")
        else:
            fail_count += 1
            print(f"  ⚠️ 書目庫未收錄此書，跳過")

        # 適度間隔避免被頻率限制
        await asyncio.sleep(0.4)

    print("\n" + "=" * 60)
    print(f"🎉 補齊任務執行完畢！成功補全: {success_count} 本，未匹配: {fail_count} 本")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(enrich_all())

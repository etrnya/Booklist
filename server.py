#!/usr/bin/env python3
"""
Booklist Local Server & Notion Bridge (server.py)
結合 Notion「我的書櫃」與 google-books-tw-mcp 的本地全端服務
"""

import os
import sys
import json
import asyncio
import datetime
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
import httpx

import importlib.util

# 動態引用同層之 google-books-tw-mcp (避免同名 server.py 衝突)
MCP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "google-books-tw-mcp"))
mcp_server_file = os.path.join(MCP_DIR, "server.py")

resolve_book = None
search_books = None
parse_and_validate_isbn = None

if os.path.exists(mcp_server_file):
    spec = importlib.util.spec_from_file_location("google_books_tw_mcp", mcp_server_file)
    if spec and spec.loader:
        mcp_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mcp_module)
        resolve_book = getattr(mcp_module, "resolve_book", None)
        search_books = getattr(mcp_module, "search_books", None)
        parse_and_validate_isbn = getattr(mcp_module, "parse_and_validate_isbn", None)

from dotenv import load_dotenv

# 優先載入本地 .env
load_dotenv()

# 預設配置 (恪守憑證衛生鐵律，絕不寫死金鑰)
NOTION_DATABASE_ID = os.environ.get("NOTION_DATABASE_ID", "45ff2f17-8ffe-4bf5-8d41-7fc0dfece19f")
NOTION_TOKEN = os.environ.get("NOTION_API_KEY", "").strip()
PORT = int(os.environ.get("PORT", "3000"))

NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}


# ============================================================================
# Notion 資料庫互動函式 (Notion API Client)
# ============================================================================

def query_notion_books() -> list[dict[str, Any]]:
    """從 Notion 讀取所有書籍清單"""
    books = []
    has_more = True
    start_cursor = None
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}/query"

    while has_more:
        body: dict[str, Any] = {"page_size": 100}
        if start_cursor:
            body["start_cursor"] = start_cursor

        resp = httpx.post(url, headers=NOTION_HEADERS, json=body, timeout=15.0)
        if resp.status_code != 200:
            print(f"❌ Notion Query 失敗: {resp.status_code} {resp.text}")
            break

        data = resp.json()
        for p in data.get("results", []):
            props = p.get("properties", {})
            
            # 書名
            title_objs = props.get("Name", {}).get("title", [])
            title = title_objs[0].get("plain_text", "") if title_objs else ""
            if not title:
                continue

            # 書封
            cover_url = None
            if p.get("cover") and p["cover"].get("external"):
                cover_url = p["cover"]["external"].get("url")
            elif props.get("書封", {}).get("files"):
                f = props["書封"]["files"][0]
                cover_url = f.get("external", {}).get("url") or f.get("file", {}).get("url")

            # ISBN
            isbn_objs = props.get("ISBN", {}).get("rich_text", [])
            isbn = isbn_objs[0].get("plain_text", "") if isbn_objs else ""

            # 作者
            authors = [a.get("name", "") for a in props.get("作者", {}).get("multi_select", [])]

            # 出版社
            pub_obj = props.get("出版社", {}).get("select")
            publisher = pub_obj.get("name", "") if pub_obj else ""

            # 形式與狀態
            format_obj = props.get("形式", {}).get("select")
            book_format = format_obj.get("name", "紙本書") if format_obj else "紙本書"

            status_obj = props.get("狀態", {}).get("select")
            book_status = status_obj.get("name", "準備讀") if status_obj else "準備讀"

            books.append({
                "id": p.get("id"),
                "title": title,
                "isbn": isbn,
                "authors": authors,
                "publisher": publisher,
                "format": book_format,
                "status": book_status,
                "cover_url": cover_url,
                "notion_url": p.get("url")
            })

        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    return books


def save_book_to_notion(payload: dict[str, Any]) -> dict[str, Any]:
    """將新書資料寫入 Notion「我的書櫃」"""
    title = payload.get("title", "").strip()
    if not title:
        return {"success": False, "message": "書名不可為空"}

    cover_url = payload.get("cover_url", "").strip() or None
    isbn = payload.get("isbn", "").strip()
    authors = payload.get("authors", [])
    if isinstance(authors, str):
        authors = [a.strip() for a in authors.split(",") if a.strip()]
    publisher = payload.get("publisher", "").strip() or None
    book_format = payload.get("format", "紙本書")
    book_status = payload.get("status", "準備讀")
    today = datetime.date.today().isoformat()

    properties: dict[str, Any] = {
        "Name": {"title": [{"text": {"content": title}}]},
        "形式": {"select": {"name": book_format}},
        "狀態": {"select": {"name": book_status}},
        "購買日期": {"date": {"start": today}}
    }

    if isbn:
        properties["ISBN"] = {"rich_text": [{"text": {"content": isbn}}]}
    if authors:
        properties["作者"] = {"multi_select": [{"name": a} for a in authors]}
    if publisher:
        properties["出版社"] = {"select": {"name": publisher}}
    if cover_url:
        properties["書封"] = {"files": [{"name": "cover.jpg", "type": "external", "external": {"url": cover_url}}]}

    body: dict[str, Any] = {
        "parent": {"database_id": NOTION_DATABASE_ID},
        "properties": properties
    }
    if cover_url:
        body["cover"] = {"type": "external", "external": {"url": cover_url}}

    resp = httpx.post("https://api.notion.com/v1/pages", headers=NOTION_HEADERS, json=body, timeout=15.0)
    if resp.status_code == 200:
        data = resp.json()
        return {
            "success": True,
            "page_id": data.get("id"),
            "url": data.get("url"),
            "message": f"成功建立書籍《{title}》至 Notion 書櫃！"
        }
    else:
        return {
            "success": False,
            "status_code": resp.status_code,
            "message": f"寫入 Notion 失敗: {resp.text}"
        }


# ============================================================================
# 五級決策階梯比對 (Duplicate Check Decision Ladder)
# ============================================================================

def evaluate_decision(candidate: dict[str, Any], library_books: list[dict[str, Any]]) -> dict[str, Any]:
    """
    五級決策階梯評估演算法：
    Level 1: ISBN 精確匹配 (Checksum Normalized)
    Level 2: 正書名與作者完全一致
    Level 3: 相似度與改版辨識
    Level 4: 無命中 ➔ 可放心購買
    """
    c_isbn = candidate.get("isbn_13") or candidate.get("isbn") or ""
    c_clean_isbn = c_isbn.replace("-", "").strip() if c_isbn else ""
    c_title = (candidate.get("title") or "").strip().lower()
    c_format = candidate.get("format", "PHYSICAL")

    # 1. Level 1: ISBN 條碼精確比對
    if c_clean_isbn:
        for b in library_books:
            b_clean_isbn = (b.get("isbn") or "").replace("-", "").strip()
            if b_clean_isbn and b_clean_isbn == c_clean_isbn:
                b_fmt = "PHYSICAL" if "紙本" in b.get("format", "") else "EBOOK"
                if b_fmt == c_format:
                    return {
                        "decision": "DO_NOT_BUY",
                        "level": 1,
                        "title": "🚨 請勿購買：已持有完全相同書籍",
                        "ownership_status": "CURRENTLY_OWNED",
                        "reasons": [
                            f"ISBN 條碼完全相符 ({b_clean_isbn})",
                            f"書名：「{b['title']}」",
                            f"目前已持有相同形式 ({b['format']})"
                        ],
                        "matched_book": b
                    }
                else:
                    return {
                        "decision": "CONSIDER",
                        "level": 2,
                        "title": "⚠️ 建議評估：已持有其他版本",
                        "ownership_status": "OWNED_OTHER_FORMAT",
                        "reasons": [
                            f"ISBN 相同，但目前持有的是 {b['format']}",
                            f"欲購買的是 {'紙本書' if c_format == 'PHYSICAL' else '電子書'}，請確認是否需要雙版本"
                        ],
                        "matched_book": b
                    }

    # 2. Level 2: 書名完全相符或相互包含
    if c_title:
        for b in library_books:
            b_title = (b.get("title") or "").strip().lower()
            if b_title == c_title or (len(c_title) >= 4 and (c_title in b_title or b_title in c_title)):
                b_fmt = "PHYSICAL" if "紙本" in b.get("format", "") else "EBOOK"
                if b_fmt == c_format:
                    return {
                        "decision": "DO_NOT_BUY",
                        "level": 2,
                        "title": "🚨 請勿購買：已持有同名書籍",
                        "ownership_status": "CURRENTLY_OWNED",
                        "reasons": [
                            f"書名高度相符：「{b['title']}」",
                            f"形式相符 ({b['format']})"
                        ],
                        "matched_book": b
                    }
                else:
                    return {
                        "decision": "CONSIDER",
                        "level": 2,
                        "title": "⚠️ 建議評估：已持有其他媒介版本",
                        "ownership_status": "OWNED_OTHER_FORMAT",
                        "reasons": [
                            f"書名高度相符：「{b['title']}」",
                            f"已持有 {b['format']}，欲購買 {'紙本書' if c_format == 'PHYSICAL' else '電子書'}"
                        ],
                        "matched_book": b
                    }

    # 3. Level 3: 增訂/改版比對
    for b in library_books:
        b_title = (b.get("title") or "").lower()
        keywords = ["增訂", "修訂", "新版", "紀念版", "第2版", "第二版"]
        if any(k in c_title or k in b_title for k in keywords):
            common_words = [w for w in c_title.split() if w in b_title]
            if common_words:
                return {
                    "decision": "CONSIDER",
                    "level": 3,
                    "title": "💡 建議確認：疑似改版或增訂版",
                    "ownership_status": "SUSPECTED",
                    "reasons": [
                        f"發現書庫現有書籍：「{b['title']}」",
                        "可能為增訂版或新裝版，請確認目錄與是否重複"
                    ],
                    "matched_book": b
                }

    # 4. Level 4: 完全無命中 ➔ 可放心購買
    return {
        "decision": "SAFE_TO_BUY",
        "level": 4,
        "title": "✅ 可放心購買！",
        "ownership_status": "NOT_OWNED",
        "reasons": [
            "Notion 書櫃中查無此書紀錄",
            "確認未重複持有，可放心加入書櫃！"
        ],
        "matched_book": None
    }


# ============================================================================
# HTTP 請求處理器 (Server Request Handler)
# ============================================================================

class BooklistHTTPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, status_code: int, data: Any):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # API: 獲取 Notion 書櫃清單
        if path == "/api/books":
            try:
                books = query_notion_books()
                self.send_json(200, {
                    "success": True,
                    "total": len(books),
                    "database_id": NOTION_DATABASE_ID,
                    "books": books
                })
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        # API: 調用 google-books-tw-mcp 搜尋書籍
        if path == "/api/search":
            q = query.get("q", [""])[0].strip()
            if not q:
                self.send_json(400, {"success": False, "message": "請輸入搜尋關鍵字 (q)"})
                return
            if not search_books:
                self.send_json(500, {"success": False, "message": "google-books-tw-mcp 模組未載入"})
                return

            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                res = loop.run_until_complete(search_books(q, max_results=5))
                loop.close()
                self.send_json(200, res)
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        # API: 調用 google-books-tw-mcp 一站式解析單本書籍
        if path == "/api/resolve":
            target = query.get("target", [""])[0].strip()
            if not target:
                self.send_json(400, {"success": False, "message": "請輸入 ISBN 或書名 (target)"})
                return
            if not resolve_book:
                self.send_json(500, {"success": False, "message": "google-books-tw-mcp 模組未載入"})
                return

            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                res = loop.run_until_complete(resolve_book(target))
                loop.close()
                self.send_json(200, res)
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        # 其他靜態檔案交付 (index.html, js, css)
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        # API: 五級查重決策階梯
        if path == "/api/check":
            target = (payload.get("isbn") or payload.get("title") or "").strip()
            resolved = None

            # 若有提供關鍵字，先透過 google-books-tw-mcp 解析標準版本
            if resolve_book and target:
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    res = loop.run_until_complete(resolve_book(target))
                    loop.close()
                    if res.get("found"):
                        resolved = res["book"]
                except Exception as err:
                    print(f"⚠️ 解析書籍時發生錯誤: {err}")

            # 提取比對基準
            candidate = {
                "isbn_13": resolved["identity"]["isbn_13"] if resolved else payload.get("isbn"),
                "title": resolved["work"]["title"] if resolved else payload.get("title"),
                "format": payload.get("format", "PHYSICAL")
            }

            try:
                books = query_notion_books()
                decision = evaluate_decision(candidate, books)
                self.send_json(200, {
                    "success": True,
                    "candidate": candidate,
                    "resolved_book": resolved,
                    "decision": decision
                })
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        # API: 將書籍儲存/匯入至 Notion
        if path == "/api/save":
            try:
                res = save_book_to_notion(payload)
                self.send_json(200 if res.get("success") else 400, res)
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        # API: 批次補全 Notion 書櫃缺少之書封與 ISBN
        if path == "/api/batch_enrich":
            try:
                books = query_notion_books()
                need_enrich = [b for b in books if not b.get("cover_url") or not b.get("isbn")]
                enriched_count = 0

                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

                for b in need_enrich:
                    target = b.get("isbn") or b.get("title")
                    if not target:
                        continue
                    res = loop.run_until_complete(resolve_book(target))
                    if res and res.get("found"):
                        book_fact = res["book"]
                        cover = book_fact["cover"]["url"]
                        isbn = book_fact["identity"]["isbn_13"]
                        patch_props = {}
                        if cover:
                            patch_props["書封"] = {"files": [{"name": "cover.jpg", "type": "external", "external": {"url": cover}}]}
                        if isbn:
                            patch_props["ISBN"] = {"rich_text": [{"text": {"content": isbn}}]}
                        
                        patch_body = {"properties": patch_props}
                        if cover:
                            patch_body["cover"] = {"type": "external", "external": {"url": cover}}

                        patch_res = httpx.patch(
                            f"https://api.notion.com/v1/pages/{b['id']}",
                            headers=NOTION_HEADERS,
                            json=patch_body,
                            timeout=10.0
                        )
                        if patch_res.status_code == 200:
                            enriched_count += 1

                loop.close()
                self.send_json(200, {
                    "success": True,
                    "scanned_total": len(books),
                    "pending_enrich": len(need_enrich),
                    "enriched_count": enriched_count
                })
            except Exception as e:
                self.send_json(500, {"success": False, "error": str(e)})
            return

        self.send_json(404, {"error": "Not Found"})


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(("127.0.0.1", PORT), BooklistHTTPHandler)
    print("=" * 60)
    print("📚 Booklist 本地服務啟動中...")
    print(f"🔗 前端網址: http://localhost:{PORT}")
    print(f"📦 Notion 書櫃 ID: {NOTION_DATABASE_ID}")
    print(f"🔍 書目解析層: google-books-tw-mcp (Taiwan Book Metadata Resolver v1.2.0)")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已正常停止。")


if __name__ == "__main__":
    main()

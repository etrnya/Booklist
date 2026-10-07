import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("NOTION_API_KEY") or os.getenv("NOTION_TOKEN")
db_id = os.getenv("NOTION_DATABASE_ID", "45ff2f17-8ffe-4bf5-8d41-7fc0dfece19f")

headers = {
    "Authorization": f"Bearer {token}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
}

all_books = []
cursor = None

print("正在自 Notion 下載最新書櫃資料...")
while True:
    payload = {"page_size": 100}
    if cursor:
        payload["start_cursor"] = cursor
    res = requests.post(f"https://api.notion.com/v1/databases/{db_id}/query", headers=headers, json=payload)
    if res.status_code != 200:
        print("Query error:", res.text)
        break
    data = res.json()
    for page in data.get("results", []):
        props = page.get("properties", {})
        title_prop = props.get("Name", {}).get("title", []) or props.get("書名", {}).get("title", [])
        title = title_prop[0].get("plain_text", "").strip() if title_prop else ""
        if not title:
            continue

        def get_rich(p):
            t = props.get(p, {}).get("rich_text", [])
            return t[0].get("plain_text", "").strip() if t else ""

        def get_select(p):
            s = props.get(p, {}).get("select")
            return s.get("name", "") if s else ""

        def get_multi_select(p):
            ms = props.get(p, {}).get("multi_select", [])
            return ", ".join([item.get("name", "") for item in ms if item.get("name")])

        author = get_multi_select("作者") or get_rich("作者")
        publisher = get_select("出版社") or get_rich("出版社")
        isbn = get_rich("ISBN")
        category = get_select("分類") or "自我成長"

        cover = ""
        if page.get("cover"):
            c = page["cover"]
            cover = c.get("external", {}).get("url", "") or c.get("file", {}).get("url", "")
        
        # 也可以檢查檔案與媒體欄位
        files_prop = props.get("書封", {}).get("files", []) or props.get("封面圖", {}).get("files", [])
        if not cover and files_prop:
            f0 = files_prop[0]
            cover = f0.get("external", {}).get("url", "") or f0.get("file", {}).get("url", "")

        all_books.append({
            "id": page["id"],
            "title": title,
            "author": author,
            "publisher": publisher,
            "isbn": isbn,
            "category": category,
            "status": "在庫",
            "cover": cover,
            "rating": 5,
            "created_at": page.get("created_time", "")
        })

    if not data.get("has_more"):
        break
    cursor = data.get("next_cursor")

with open("mock_books.json", "w", encoding="utf-8") as f:
    json.dump(all_books, f, ensure_ascii=False, indent=2)

print(f"SUCCESS: Exported {len(all_books)} books to mock_books.json! With cover: {sum(1 for b in all_books if b.get('cover'))}")

import httpx
from bs4 import BeautifulSoup
import urllib.parse

query = urllib.parse.quote('"carbon voice" webhook')
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
with open("scratch/search_cv_github.log", "w", encoding="utf-8") as f:
    try:
        res = httpx.get(f"https://html.duckduckgo.com/html/?q={query}", headers=headers, timeout=10.0)
        soup = BeautifulSoup(res.text, 'html.parser')
        snippets = soup.find_all('a', class_='result__snippet')
        for s in snippets:
            f.write(s.get_text() + "\n---\n")
    except Exception as e:
        f.write(f"Failed: {e}\n")

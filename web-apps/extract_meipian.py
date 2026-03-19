#!/usr/bin/env python3
"""
Extract meipian.cn articles and build local HTML pages with downloaded images.
"""
import requests
import re
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.meipian.cn/',
}

ARTICLES = [
    {'url': 'https://www.meipian.cn/5ktypf9i', 'date': '20260315', 'slug': 'nyc-half-marathon'},
    {'url': 'https://www.meipian.cn/5kghaccx', 'date': '20260301', 'slug': 'washington-heights-5k'},
    {'url': 'https://www.meipian.cn/5kah2zly', 'date': '20260222', 'slug': 'lanshan-annual-gala'},
]

CDN_BASE = 'https://ss-mpvolc.meipian.me/users/'
IMG_SUFFIX = '~tplv-s1ctq42ewb-s3-cC-q:0:0:0:0:q80.webp'


def fetch_article_data(url):
    """Fetch page and extract ARTICLE_DETAIL JSON."""
    print(f"Fetching: {url}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.encoding = 'utf-8'
    html = resp.text

    # Extract ARTICLE_DETAIL JSON from script tag
    match = re.search(r'var ARTICLE_DETAIL\s*=\s*(\{.*?\});\s*(?:var|window|</script>)', html, re.DOTALL)
    if not match:
        # Try broader match
        match = re.search(r'var ARTICLE_DETAIL\s*=\s*(\{.+)', html, re.DOTALL)
        if match:
            # Find the balanced JSON
            raw = match.group(1)
            # Try to parse incrementally
            for end in range(len(raw), 0, -100):
                try:
                    data = json.loads(raw[:end])
                    return data
                except:
                    pass

    if match:
        try:
            return json.loads(match.group(1))
        except Exception as e:
            print(f"  JSON parse error: {e}")

    print("  Could not extract ARTICLE_DETAIL")
    return None


def extract_content_blocks(article_data):
    """
    Extract ordered content blocks from ARTICLE_DETAIL.
    Returns list of dicts: {type: 'text'|'image', ...}
    """
    content_items = article_data.get('content', [])
    author_info = article_data.get('author', {})
    article_info = article_data.get('article', {})

    blocks = []

    # Article metadata
    title = article_info.get('title', '')
    author_name = author_info.get('screen_name', '福懒客')
    cover_url = article_info.get('cover_img_url', '')

    # Clean title - remove zero-width chars
    title = re.sub(r'[\u200d\u200b\u200c\ufeff]', ' ', title).strip()

    for item in content_items:
        ext = item.get('ext', {})
        text = item.get('text', '')
        if isinstance(text, (list, dict)):
            text = json.dumps(text, ensure_ascii=False)

        is_image = 'imageSaturability' in ext or 'imageContrast' in ext or item.get('img_url')

        if is_image:
            # Image block - text is just the caption HTML
            caption_html = text if isinstance(text, str) else ''
            # img_url is stored directly in the item
            img_url = item.get('img_url') or item.get('img') or None

            # Fallback: check ext or text
            if not img_url:
                if 'url' in ext:
                    img_url = ext['url']
                elif isinstance(text, str) and ('meipian.me' in text or 'heic' in text or 'jpg' in text):
                    url_match = re.search(r'https://[^\s"<>]+(?:heic|jpg|jpeg|png|webp)[^\s"<>]*', text)
                    if url_match:
                        img_url = url_match.group(0)

            blocks.append({
                'type': 'image',
                'caption_html': caption_html,
                'url': img_url,
                'width': item.get('img_width', 0),
                'height': item.get('img_height', 0),
            })
        else:
            # Text block
            blocks.append({
                'type': 'text',
                'html': text if isinstance(text, str) else '',
            })

    return {
        'title': title,
        'author': author_name,
        'cover_url': cover_url,
        'blocks': blocks,
    }


def get_image_url_from_block(block, user_id):
    """Try to reconstruct image URL from available data."""
    url = block.get('url')
    if url:
        if not url.startswith('http'):
            url = CDN_BASE + user_id + '/' + url + IMG_SUFFIX
        return url
    return None


def download_image(url, dest_path, session):
    """Download an image to dest_path."""
    if dest_path.exists():
        return True
    try:
        resp = session.get(url, headers=HEADERS, timeout=30, stream=True)
        if resp.status_code == 200:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, 'wb') as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)
            return True
        else:
            print(f"  HTTP {resp.status_code} for {url}")
            return False
    except Exception as e:
        print(f"  Download error: {e}")
        return False


def sanitize_filename(name):
    """Convert string to safe filename."""
    name = re.sub(r'[^\w\u4e00-\u9fff\-]', '_', name)
    return name[:50]


def build_html(article_data, images_dir_name, img_index_map):
    """Build meipian-style HTML page."""
    title = article_data['title']
    author = article_data['author']
    blocks = article_data['blocks']

    # Build content HTML
    content_parts = []
    img_counter = [0]

    for block in blocks:
        if block['type'] == 'text':
            html = block['html']
            if html.strip():
                # Clean up meipian-specific wrapper divs but keep ql-block content
                html = re.sub(r'<!--.*?-->', '', html)
                html = re.sub(r'<div[^>]*mp-article-texts[^>]*>', '', html)
                html = re.sub(r'<div[^>]*mp-article-texts-word[^>]*>', '', html)
                html = re.sub(r'<div[^>]*mp-article-texts-newword[^>]*>', '', html)
                html = re.sub(r'</div>\s*$', '', html.rstrip())
                content_parts.append(f'<div class="text-block">{html}</div>')

        elif block['type'] == 'image':
            caption_html = block['caption_html']

            # Caption text
            if caption_html and caption_html.strip():
                caption_clean = re.sub(r'<!--.*?-->', '', caption_html)
                caption_clean = re.sub(r'<div[^>]*mp-article-texts[^>]*>', '', caption_clean)
                caption_clean = re.sub(r'<div[^>]*mp-article-texts-word[^>]*>', '', caption_clean)
                caption_clean = re.sub(r'<div[^>]*mp-article-texts-newword[^>]*>', '', caption_clean)
                caption_clean = re.sub(r'</div>\s*$', '', caption_clean.rstrip())
                caption_text = re.sub(r'<[^>]+>', '', caption_clean).strip()
                if caption_text:
                    content_parts.append(f'<div class="text-block caption-block">{caption_clean}</div>')

            # Image
            idx = img_counter[0]
            img_counter[0] += 1

            if idx in img_index_map:
                img_filename = img_index_map[idx]
                img_src = f'{images_dir_name}/{img_filename}'
                content_parts.append(f'''<div class="image-block">
  <img src="{img_src}" alt="photo {idx+1}" loading="lazy" />
</div>''')

    content_html = '\n'.join(content_parts)

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}

  body {{
    background: #f5f5f5;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    color: #333;
    line-height: 1.8;
  }}

  .article-wrapper {{
    max-width: 680px;
    margin: 0 auto;
    background: #fff;
    min-height: 100vh;
  }}

  /* Header */
  .article-header {{
    background: linear-gradient(135deg, #c0392b 0%, #922b21 100%);
    padding: 40px 24px 30px;
    text-align: center;
    position: relative;
  }}

  .article-header::after {{
    content: '';
    position: absolute;
    bottom: -20px;
    left: 0; right: 0;
    height: 40px;
    background: #fff;
    border-radius: 20px 20px 0 0;
  }}

  .article-title {{
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    line-height: 1.5;
    white-space: pre-line;
    letter-spacing: 0.5px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }}

  .article-meta {{
    margin-top: 12px;
    color: rgba(255,255,255,0.85);
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }}

  .author-badge {{
    background: rgba(255,255,255,0.2);
    border-radius: 20px;
    padding: 3px 12px;
  }}

  /* Content area */
  .article-content {{
    padding: 40px 20px 60px;
  }}

  /* Text blocks */
  .text-block {{
    margin-bottom: 8px;
  }}

  .text-block .ql-block {{
    margin-bottom: 12px;
    font-size: 16px;
    line-height: 1.9;
    color: #333;
  }}

  .text-block b, .text-block strong {{
    font-weight: 700;
    color: #222;
  }}

  .text-block i {{
    font-style: italic;
  }}

  /* Caption blocks (red italic text) */
  .caption-block {{
    text-align: center;
    margin: 8px 0 4px;
  }}

  .caption-block .ql-block {{
    font-size: 13px;
    color: #ed2308;
    font-style: italic;
    margin-bottom: 4px;
  }}

  /* Image blocks */
  .image-block {{
    margin: 8px -4px 16px;
    text-align: center;
  }}

  .image-block img {{
    width: 100%;
    max-width: 100%;
    height: auto;
    display: block;
    border-radius: 4px;
  }}

  /* Divider */
  .section-divider {{
    text-align: center;
    margin: 24px 0;
    color: #c0392b;
    font-size: 18px;
  }}

  /* Footer */
  .article-footer {{
    background: #f9f9f9;
    border-top: 1px solid #eee;
    padding: 20px;
    text-align: center;
    font-size: 12px;
    color: #999;
  }}

  .meipian-source {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    color: #c0392b;
    font-size: 13px;
  }}

  /* Responsive */
  @media (max-width: 480px) {{
    .article-title {{ font-size: 18px; }}
    .article-content {{ padding: 30px 16px 40px; }}
  }}
</style>
</head>
<body>
<div class="article-wrapper">
  <div class="article-header">
    <div class="article-title">{title}</div>
    <div class="article-meta">
      <span class="author-badge">✍️ {author}</span>
    </div>
  </div>

  <div class="article-content">
    {content_html}
  </div>

  <div class="article-footer">
    <div>本文内容来自美篇</div>
    <div class="meipian-source">📱 meipian.cn</div>
  </div>
</div>
</body>
</html>'''

    return html


def main():
    output_base = Path('/sessions/wizardly-affectionate-shannon/mnt/web-apps')
    output_base.mkdir(parents=True, exist_ok=True)

    session = requests.Session()

    for article_info in ARTICLES:
        url = article_info['url']
        date_str = article_info['date']
        slug = article_info['slug']

        print(f"\n{'='*60}")
        print(f"Processing: {url}")

        # Fetch article data
        data = fetch_article_data(url)
        if not data:
            print("  SKIPPING - could not get data")
            continue

        # Extract content
        article_content = extract_content_blocks(data)
        title = article_content['title']
        user_id = str(data.get('article', {}).get('user_id', '4440264'))

        print(f"  Title: {title}")
        print(f"  Blocks: {len(article_content['blocks'])}")

        # Count image blocks
        img_blocks = [b for b in article_content['blocks'] if b['type'] == 'image']
        print(f"  Image blocks: {len(img_blocks)}")

        # Create output directories
        folder_name = f"{date_str}-{slug}"
        article_dir = output_base / folder_name
        images_dir = article_dir / 'images'
        images_dir.mkdir(parents=True, exist_ok=True)

        print(f"  Output dir: {article_dir}")

        # Save article data for debugging
        with open(article_dir / 'article_data.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  Saved article_data.json ({os.path.getsize(article_dir / 'article_data.json')} bytes)")

        # Build image index map
        img_index_map = {}
        img_download_count = 0

        for idx, block in enumerate(img_blocks):
            img_url = block.get('url')
            if not img_url:
                print(f"  Warning: image {idx} has no URL")
                continue

            # Construct CDN URL if needed
            if not img_url.startswith('http'):
                img_url = f"{CDN_BASE}{user_id}/{img_url}{IMG_SUFFIX}"
            elif '~tplv' not in img_url:
                img_url = img_url + IMG_SUFFIX

            # Extract filename
            path_match = re.search(r'/users/\d+/([^~?]+)', img_url)
            if not path_match:
                continue

            raw_filename = path_match.group(1)
            # Create safe filename: use index + hash
            ext = 'webp'  # We're downloading as webp
            img_filename = f"img_{idx:03d}_{raw_filename[:20]}.{ext}"
            dest_path = images_dir / img_filename

            img_index_map[idx] = img_filename

            # Download
            print(f"  Downloading image {idx+1}/{len(img_blocks)}: {raw_filename[:30]}...")
            if download_image(img_url, dest_path, session):
                img_download_count += 1

            time.sleep(0.1)  # Be polite

        print(f"  Downloaded {img_download_count}/{len(img_blocks)} images")

        # Build HTML
        html = build_html(article_content, 'images', img_index_map)

        html_path = article_dir / 'index.html'
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html)

        print(f"  Saved HTML: {html_path}")
        print(f"  HTML size: {os.path.getsize(html_path):,} bytes")


if __name__ == '__main__':
    main()

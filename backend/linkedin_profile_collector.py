#!/usr/bin/env python3
"""
LinkedIn profile collector (no SerpApi, no paid API).

Finds public LinkedIn profile URLs by running `site:linkedin.com/in ...` searches
on DuckDuckGo (via the `ddgs` library) and Bing (plain HTML), then parses
name / title / company from the result titles and snippets.
Same segments, keywords, filters, dedupe and 1000-profile cap as your n8n workflow.

INDUSTRY IS NEVER GUESSED. Phase 1 collects profiles. Phase 2 (enrich) finds each
person's company on LinkedIn and fills Industry / Company size from the company's own
page data (search-result text -> public company page -> optional Apify scraper).
If an industry can't be verified the cell stays blank (it is never filled from the keyword).

Install:   pip install ddgs requests beautifulsoup4
Run:       python linkedin_profile_collector.py                 (collect + enrich)
           python linkedin_profile_collector.py --enrich-only   (fix an existing profiles.csv)
           python linkedin_profile_collector.py --segments A --regions NJ --target 1000
Output:    profiles.csv. Safe to stop (Ctrl+C) and restart any time: finished searches are
           remembered in done_searches.txt, known profiles are never added twice.
           Close the CSV in Excel before running (Windows locks open files).

Note: scraping LinkedIn-related data is against LinkedIn's Terms of Service, and
search engines may throttle you. Keep the delays, and run in smaller batches if blocked.
"""
import argparse, base64, csv, os, random, re, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import parse_qs, quote_plus, urlparse

import requests
from bs4 import BeautifulSoup

try:
    from ddgs import DDGS
except ImportError:  # older package name
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        DDGS = None

# ============================ CONFIG ============================
RUN_SEGMENTS = ['A', 'B', 'C']
RUN_REGIONS = ['NJ']                 # 'NJ', 'LV'
PAGES = [1, 2, 3]                    # result pages per search
TARGET_PROFILES = 1000
DELAY_RANGE = (3, 7)                 # seconds each worker pauses after a search (random)
WORKERS = 3                          # parallel searches (1 = slowest/safest, 4-5 = faster but more blocks)
ENGINES = ['yahoo', 'bing']            # tried in rotation; falls back if one is blocked
OUT_FILE = 'profiles.csv'
DONE_FILE = 'done_searches.txt'       # one line per finished search -> restart skips them
CACHE_FILE = 'company_cache.json'     # remembers every company lookup between runs
REJECTED_FILE = 'rejected_urls.txt'   # profiles dropped by the industry/size filters
FETCH_COMPANY_PAGE = True             # try the public LinkedIn company page if search text has no industry
FILTER_BY_SEGMENT_INDUSTRY = True     # drop people whose VERIFIED industry doesn't fit the segment
DROP_UNVERIFIED = False               # True = also drop people whose industry could not be verified
APIFY_TOKEN = os.environ.get('APIFY_TOKEN', '')   # optional: same actor your n8n workflow uses
APIFY_ACTOR = 'automation-lab~linkedin-company-scraper'
# ================================================================

REGIONS = {
    'LV': {'term': 'Las Vegas'},
    'NJ': {'term': 'New Jersey'},
}

SEGMENTS = {
    'A': {
        'keywords': ['tobacco', 'vape', 'e-liquid', 'nicotine', 'hookah', 'cigar', 'energy drink', 'tobacco products', 'tobacco company', 'vaping', 'vape juice', 'e-juice', 'e-cigarette', 'nicotine products', 'cigarettes', 'hookah tobacco', 'premium cigars', 'energy drinks'],
        'exclude': '-perfume -fragrance -cosmetics -apparel',
        'titles': {
            'CXO': 'COO OR "Chief Operating Officer" OR "VP Operations" OR Owner OR CEO',
            'Marketing': 'CMO OR "VP Marketing" OR "Head of Marketing" OR "Director of Marketing" OR "Brand Manager" OR "Marketing Manager"',
        },
    },
    'B': {
        'keywords': ['smoke shop', 'vape shop', 'tobacco wholesale', 'wholesale distributor', 'convenience store', 'smoke shops', 'vape shops', 'vape store', 'tobacco shop', 'tobacco store', 'wholesale tobacco', 'tobacco distributor', 'tobacco wholesaler', 'wholesale distribution', 'convenience stores', 'c-store'],
        'exclude': '',
        'titles': {
            'CXO': 'Owner OR CEO OR COO',
            'IT': '"IT Manager" OR "Director of IT" OR "Head of Technology" OR "Systems Administrator"',
            'Marketing': '"Marketing Manager" OR "Digital Marketing Manager" OR "E-commerce Manager"',
        },
    },
    'C': {
        'keywords': ['digital agency', 'digital marketing', 'software development', 'print shop', 'printing', 'promotional products', 'merchandise', 'graphic design', 'digital marketing agency', 'marketing agency', 'software company', 'custom software', 'printing company', 'print services', 'commercial printing', 'promotional merchandise', 'promo products', 'branded merchandise', 'graphic designer', 'design agency'],
        'exclude': '',
        'titles': {'CXO': 'CTO OR CEO OR COO OR Founder OR "Co-founder"'},
    },
}

# Industries accepted per segment (LinkedIn's own industry names) - from your original workflow
SEGMENT_INDUSTRIES = {
    'A': ['Tobacco Manufacturing', 'Beverage Manufacturing', 'Food and Beverage Manufacturing'],
    'B': ['Wholesale', 'Retail', 'Food and Beverage Retail', 'Wholesale Import and Export'],
    'C': ['Advertising Services', 'Marketing Services', 'IT Services and IT Consulting',
          'Software Development', 'Design Services', 'Printing Services'],
}

DEBUG = False


COLUMNS = ['tab', 'Region', 'Segment', 'Company name', 'Company size', 'Industry',
           'Industry source', 'Full name', 'Title', 'Profile URL', 'Location',
           'Contact type', 'Search used', 'Date collected', 'Approved']

BAD_TITLE = re.compile(r'student|\bintern\b|trainee|freelanc|open to work|job seeker', re.I)
BAD_INDUSTRY = re.compile(r'education|fashion|real estate|casino|hotel|staffing|health', re.I)

UA = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
]


# ----------------------------- search engines -----------------------------
class Blocked(Exception):
    pass


def unwrap_bing(href):
    """Bing wraps result links in bing.com/ck/a?...&u=a1<base64url>. Decode them."""
    if 'bing.com/ck/a' in href:
        u = parse_qs(urlparse(href).query).get('u', [''])[0]
        if u.startswith('a1'):
            b = u[2:]
            b += '=' * (-len(b) % 4)
            try:
                return base64.urlsafe_b64decode(b).decode('utf-8', 'ignore')
            except Exception:
                pass
    return href


def parse_bing_html(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = []
    for li in soup.select('li.b_algo'):
        a = li.select_one('h2 a')
        if not a:
            continue
        cap = li.select_one('.b_caption p') or li.select_one('.b_lineclamp2') or li.select_one('p')
        url = unwrap_bing(a.get('href', ''))
        if 'linkedin.com' not in url:  # fall back to the visible <cite> URL
            cite = li.select_one('cite')
            if cite:
                url = 'https://' + cite.get_text(' ', strip=True).replace(' › ', '/').replace('https://', '')
        out.append({'title': a.get_text(' ', strip=True), 'url': url,
                    'snippet': cap.get_text(' ', strip=True) if cap else ''})
    return out


_bing = requests.Session()


def search_bing(query, page):
    first = (page - 1) * 10 + 1
    url = f'https://www.bing.com/search?q={quote_plus(query)}&first={first}&count=10&setlang=en-US&cc=US&mkt=en-US'
    headers = {'User-Agent': random.choice(UA), 'Accept-Language': 'en-US,en;q=0.9',
               'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
               'Referer': 'https://www.bing.com/'}
    last = None
    for attempt in range(2):
        try:
            r = _bing.get(url, headers=headers, timeout=30)
            break
        except requests.exceptions.ConnectionError as e:   # Bing resets the connection when it dislikes us
            last = e
            time.sleep(random.uniform(4, 8))
    else:
        raise Blocked(f'bing connection reset ({str(last)[:40]})')
    if r.status_code in (403, 429) or 'captcha' in r.text.lower()[:5000]:
        raise Blocked(f'bing {r.status_code}')
    r.raise_for_status()
    return parse_bing_html(r.text)


DELAY_RANGE = (0.5, 1.5)                 # seconds each worker pauses after a search (random)
WORKERS = 3                          # parallel searches (1 = slowest/safest, 4-5 = faster but more blocks)
ENGINES = ['yahoo', 'bing']   # tried in rotation; falls back if one is blocked


def search_yahoo(query, page):
    if DDGS is None:
        raise Blocked('ddgs not installed (pip install ddgs)')
    try:
        clean_q = re.sub(r'\([A-Za-z0-9\s"_-]+(?:\s+OR\s+[A-Za-z0-9\s"_-]+){2,}\)', 'CEO OR Founder OR Owner', query)
        d = DDGS(timeout=8)
        res = list(d.text(clean_q, backend='yahoo', max_results=10))
        return [{'title': x.get('title', ''), 'url': x.get('href', ''), 'snippet': x.get('body', '')} for x in res or []]
    except Exception as e:
        if 'No results found' in str(e):
            return []
        raise Blocked(f'yahoo: {e}')


def search_ddg(query, page):
    if DDGS is None:
        raise Blocked('ddgs not installed (pip install ddgs)')
    try:
        try:
            d = DDGS(timeout=3)
            res = list(d.text(query, backend='lite', max_results=10))
        except Exception:
            d = DDGS(timeout=3)
            res = list(d.text(query, max_results=10))
        return [{'title': x.get('title', ''), 'url': x.get('href', ''), 'snippet': x.get('body', '')} for x in res or []]
    except Exception as e:
        if 'No results found' in str(e):
            return []
        raise Blocked(f'ddg: {e}')


SEARCH = {'yahoo': search_yahoo, 'bing': search_bing, 'ddg': search_ddg}


def run_search(query, page, order, must=r'linkedin\.com/in/'):
    """Try engines in order. Returns a list of LinkedIn results (empty = genuinely none),
    or None if every engine failed/blocked/returned junk (caller retries it next run)."""
    answered = False
    for name in order:
        try:
            res = SEARCH[name](query, page)
        except Blocked as e:
            time.sleep(random.uniform(0.5, 1.5))
            continue
        except Exception as e:
            time.sleep(random.uniform(0.5, 1.0))
            continue
        if res is not None:
            answered = True
            good = [x for x in res if re.search(must, x.get('url', ''), re.I)]
            if good:
                return good
    return [] if answered else None


# ----------------------------- parsing (port of n8n code) -----------------------------
def tidy(v):
    return re.sub(r'\s*(\.{3}|\u2026)\s*$', '', str(v or '')).strip()


def clean_linkedin_url(url: str, full_name: str = "", company: str = "") -> str:
    if not url:
        return ""
    base = "https://in.linkedin.com/in/" if ("in.linkedin.com" in url or "/in/" in url) else "https://www.linkedin.com/in/"
    m = re.search(r"linkedin\.com/in/([^/?#]+)", url, re.I)
    if not m:
        return url.split("?")[0].rstrip("/")
    slug = m.group(1).strip()

    if full_name:
        name_clean = re.sub(r"[^a-zA-Z0-9]+", "", full_name).lower()
        slug_clean = re.sub(r"[^a-zA-Z0-9]+", "", slug).lower()
        if name_clean and (slug_clean.startswith(name_clean) or name_clean in slug_clean):
            rem = slug_clean[len(name_clean):]
            if re.match(r"^\d+$", rem):
                return f"{base}{name_clean}{rem}"
            else:
                return f"{base}{name_clean}"

    # Remove trailing hyphen or noise
    clean_slug = slug.strip("-")
    return f"{base}{clean_slug}"


def parse_result(r):
    link = r.get('url') or ''
    if not re.search(r'linkedin\.com/in/', link, re.I):
        return None
    raw_title = str(r.get('title') or '')
    clean = re.split(r'\s*[|\-\u2013]\s*LinkedIn', raw_title, flags=re.I)[0].strip()
    clean = re.sub(r'\s*(\.{3}|\u2026)\s*$', '', clean).strip()
    parts = [x.strip() for x in re.split(r'\s+[-\u2013]\s+', clean)]
    parts += [''] * (3 - len(parts))
    full_name = parts[0]
    snip = str(r.get('snippet') or '')
    title = parts[1]
    title_cut = bool(re.search(r'(\.{3}|\u2026)\s*$', title))
    company = tidy(parts[2])
    at = re.match(r'^(.*?)\s+(?:at|@)\s+(.+)$', title, re.I)
    if at:
        title = at.group(1).strip()
        company = company or tidy(at.group(2))
    if title_cut:
        if not company:
            company = tidy(title)
        title = ''
    if re.search(r'area|united states|region', company, re.I):
        company = ''
    if not company and at:
        company = tidy(at.group(2))
    if re.search(r'\s(?:at|@)\s', company, re.I):
        company = re.split(r'\s+(?:at|@)\s+', company, flags=re.I)[-1].strip()
    exp = re.search(r'Experience:\s*([^\u00b7|]+)', snip, re.I)
    if exp and (not company or re.search(r'(\.{3}|\u2026)\s*$', parts[2])):
        company = tidy(exp.group(1))
    profile_url = clean_linkedin_url(link, full_name, company)
    loc_m = re.search(r'Location:\s*([^\u00b7|\n]+)', snip)
    location = loc_m.group(1).strip() if loc_m else ''
    return {'full_name': full_name, 'title': title, 'company': company,
            'profile_url': profile_url, 'location': location}


# ----------------------------- jobs -----------------------------
def build_jobs(segments, regions, pages):
    jobs = []
    for r_key in regions:
        term = REGIONS[r_key]['term']
        for s_key in segments:
            seg = SEGMENTS[s_key]
            for kw in seg['keywords']:
                kw_text = f'"{kw}"' if ' ' in kw else kw
                company_kw = f"{kw_text} {seg['exclude']}".strip()
                for ctype, title_q in seg['titles'].items():
                    jobs.append({
                        'region': r_key, 'segment': s_key, 'tab': f'{r_key}-{s_key}',
                        'keyword': kw,
                        'contact_type': ctype,
                        'query': f'site:linkedin.com/in "{term}" {company_kw} ({title_q})',
                        'search_used': f'{r_key}|{s_key}|{ctype}|kw:{kw}',
                    })
    # page 1 of everything first, then page 2, ... (a partial run still covers all searches)
    return [dict(j, page=p, search_used=f"{j['search_used']}|p{p}") for p in pages for j in jobs]


REASON = ''


def accept(parsed, job, seen, counts):
    """Collection-phase filters (same as the n8n node). Industry/size filters run later in enrich."""
    global REASON
    if not parsed or not parsed['profile_url'] or not parsed['full_name']:
        REASON = 'not a /in/ profile or no name'
        return None
    loc, company, title = parsed['location'], parsed['company'], parsed['title']
    if job['region'] == 'LV' and loc and not re.search(r'las vegas', loc, re.I):
        REASON = f'location not Las Vegas ({loc})'
        return None
    if job['region'] == 'NJ' and loc and not re.search(r'new jersey|\bNJ\b', loc, re.I):
        REASON = f'location not New Jersey ({loc})'
        return None
    if not company:
        REASON = 'could not read a company from the title'
        return None
    if BAD_TITLE.search(title):
        REASON = f'bad title ({title})'
        return None
    key = parsed['profile_url'].lower()
    if key in seen:
        REASON = 'duplicate'
        return None
    if job['segment'] == 'B' and job['contact_type'] != 'CXO':
        ck = f"{job['region']}|{re.sub(r'[^a-z0-9]', '', company.lower())}"
        if counts.get(ck, 0) >= 5:
            REASON = 'company already has 5 contacts'
            return None
        counts[ck] = counts.get(ck, 0) + 1
    seen.add(key)
    return {
        'tab': job['tab'], 'Region': job['region'], 'Segment': job['segment'],
        'Company name': company, 'Company size': '', 'Industry': '',
        'Industry source': '',
        'Full name': parsed['full_name'], 'Title': title, 'Profile URL': parsed['profile_url'],
        'Location': loc, 'Contact type': job['contact_type'], 'Search used': job['search_used'],
        'Date collected': time.strftime('%Y-%m-%d'), 'Approved': '',
    }


# ----------------------------- enrichment: REAL industry from the company -----------------------------
import json

IND_RE = re.compile(r'Industry:?\s*([A-Z][A-Za-z,&/\- ]{2,70}?)(?=\s*(?:[.\u00b7|\n]|Company size|Headquarters|Founded|Type:|Specialties|Website|$))')
SIZE_RE = re.compile(r'Company size:?\s*([\d,]+(?:\s*[-\u2013]\s*[\d,]+|\+)?\s*employees)', re.I)
_page_failures = 0   # circuit breaker for LinkedIn page fetches


def norm_company(v):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(llc|inc|corp|co|ltd|the)\b', '', str(v or '').lower()))


def parse_company_text(text):
    """Pull 'Industry: X' and 'Company size: Y' out of a search snippet / meta description."""
    ind = IND_RE.search(text or '')
    size = SIZE_RE.search(text or '')
    return (ind.group(1).strip() if ind else ''), (size.group(1).strip() if size else '')


def parse_company_html(html):
    soup = BeautifulSoup(html, 'html.parser')
    industry = size = ''
    el = soup.select_one('[data-test-id="about-us__industry"] dd')
    if el:
        industry = el.get_text(' ', strip=True)
    el = soup.select_one('[data-test-id="about-us__size"] dd')
    if el:
        size = el.get_text(' ', strip=True)
    if not industry or not size:  # fallbacks: meta description / any dt+dd pair
        meta = soup.find('meta', attrs={'property': 'og:description'}) or soup.find('meta', attrs={'name': 'description'})
        i2, s2 = parse_company_text(meta.get('content', '') if meta else '')
        industry, size = industry or i2, size or s2
        for dt in soup.find_all('dt'):
            label, dd = dt.get_text(strip=True).lower(), dt.find_next('dd')
            if dd and label == 'industry' and not industry:
                industry = dd.get_text(' ', strip=True)
            if dd and label == 'company size' and not size:
                size = dd.get_text(' ', strip=True)
    return industry, size


def fetch_company_page(slug):
    """Public (logged-out) company page. LinkedIn often blocks this; fail softly."""
    global _page_failures
    if _page_failures >= 5:      # stop hammering LinkedIn after repeated blocks
        return '', ''
    try:
        r = requests.get(f'https://www.linkedin.com/company/{slug}/', timeout=30,
                         headers={'User-Agent': random.choice(UA), 'Accept-Language': 'en-US,en;q=0.9'})
        if r.status_code != 200 or 'authwall' in r.url or 'Sign Up' in r.text[:3000]:
            _page_failures += 1
            return '', ''
        _page_failures = 0
        return parse_company_html(r.text)
    except Exception:
        _page_failures += 1
        return '', ''


def lookup_company(name):
    """Find the company's LinkedIn page and read its real industry / size. Never guesses."""
    info = {'name': name, 'slug': '', 'industry': '', 'size': '', 'source': '', 'apify_tried': False}
    res = run_search(f'site:linkedin.com/company "{name}"', 1, ENGINES, must=r'linkedin\.com/company/')
    info['retry'] = res is None    # every engine failed -> don't cache, try again next run
    want = norm_company(name)
    for x in res or []:
        m = re.search(r'linkedin\.com/company/([^/?#]+)', x.get('url', ''), re.I)
        if not m:
            continue
        found = norm_company(re.sub(r'\s*[|\-\u2013]\s*LinkedIn.*$', '', x.get('title', ''), flags=re.I))
        if len(found) < 3 or len(want) < 3 or not (found in want or want in found):
            continue                                   # must be the same company
        info['slug'] = m.group(1).lower()
        ind, size = parse_company_text(f"{x.get('title', '')} . {x.get('snippet', '')}")
        if ind:
            info.update(industry=ind, size=size, source='LinkedIn (search result)')
        break
    if info['slug'] and not info['industry'] and FETCH_COMPANY_PAGE:
        ind, size = fetch_company_page(info['slug'])
        if ind:
            info.update(industry=ind, size=size, source='LinkedIn (company page)')
    return info


def _apify_industry(o):
    v = o.get('industry') or o.get('industries') or o.get('companyIndustry')
    return str(v[0] if isinstance(v, list) and v else (v or '')).strip()


def _apify_size(o):
    v = o.get('employeeRange') or o.get('employeeCountRange') or o.get('companySize') or o.get('staffCountRange') or o.get('size')
    if isinstance(v, dict):
        lo, hi = v.get('start', v.get('min')), v.get('end', v.get('max'))
        return f'{lo}-{hi} employees' if lo is not None and hi is not None else ''
    if isinstance(v, str) and v.strip():
        return v if 'employee' in v.lower() else f'{v} employees'
    n = o.get('employeeCount') or o.get('staffCount')
    return f'{n} employees' if n else ''


def apify_fill(cache):
    """Optional: ask Apify's LinkedIn company scraper for companies we found a page for but no industry."""
    pending = {k: v for k, v in cache.items() if v.get('slug') and not v.get('industry') and not v.get('apify_tried')}
    if not APIFY_TOKEN or not pending:
        return
    keys = list(pending)
    print(f'Apify: looking up {len(keys)} companies ...')
    for i in range(0, len(keys), 25):
        batch = keys[i:i + 25]
        urls = [f"https://www.linkedin.com/company/{cache[k]['slug']}" for k in batch]
        try:
            r = requests.post(f'https://api.apify.com/v2/acts/{APIFY_ACTOR}/run-sync-get-dataset-items',
                              params={'token': APIFY_TOKEN}, json={'companyUrls': urls, 'maxCompanies': len(urls)}, timeout=320)
            items = r.json() if r.ok else []
        except Exception as e:
            print('  apify error:', e)
            items = []
        by_slug = {}
        for o in items if isinstance(items, list) else []:
            u = str(o.get('linkedinUrl') or o.get('canonicalUrl') or o.get('url') or o.get('inputUrl') or '')
            m = re.search(r'company/([^/?#]+)', u, re.I)
            if m:
                by_slug[m.group(1).lower()] = o
        for k in batch:
            cache[k]['apify_tried'] = True
            o = by_slug.get(cache[k]['slug'])
            if o and _apify_industry(o):
                cache[k].update(industry=_apify_industry(o), size=_apify_size(o) or cache[k]['size'], source='LinkedIn (Apify)')


def first_number(s):
    m = re.search(r'\d[\d,]*', str(s))
    return int(m.group(0).replace(',', '')) if m else None


def industry_fits(segment, industry):
    allowed = SEGMENT_INDUSTRIES.get(segment, [])
    il = industry.lower()
    return any(a.lower() == il or a.lower() in il or il in a.lower() for a in allowed)


def enrich_csv(path):
    """Fill Industry / Company size with VERIFIED data, then apply industry + size filters."""
    if not os.path.exists(path):
        print('Nothing to enrich:', path, 'not found')
        return
    with open(path, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    for r in rows:  # wipe values guessed by older versions
        if r.get('Industry source') in ('Search keyword', ''):
            r['Industry'] = r['Industry source'] = ''

    cache = json.load(open(CACHE_FILE, encoding='utf-8')) if os.path.exists(CACHE_FILE) else {}
    names = sorted({r['Company name'] for r in rows if r.get('Company name')})
    todo = [n for n in names if norm_company(n) not in cache]
    print(f'Enriching: {len(rows)} profiles, {len(names)} companies ({len(todo)} new lookups)')
    def work(n):
        c = lookup_company(n)
        time.sleep(random.uniform(*DELAY_RANGE))
        return n, c

    ex = ThreadPoolExecutor(max_workers=WORKERS)
    try:
        futs = [ex.submit(work, n) for n in todo]
        for i, fut in enumerate(as_completed(futs), 1):
            n, c = fut.result()
            if not c.pop('retry', False):                    # failed lookups are retried next run
                cache[norm_company(n)] = c
                json.dump(cache, open(CACHE_FILE, 'w', encoding='utf-8'), indent=1)   # saved after every company
            print(f"[{i}/{len(todo)}] {n} -> {c['industry'] or '(not verified)'}")
    except KeyboardInterrupt:
        print('\nStopped - lookups so far are saved; run again to continue where this stopped.')
        ex.shutdown(wait=False, cancel_futures=True)
    else:
        ex.shutdown()
    apify_fill(cache)
    json.dump(cache, open(CACHE_FILE, 'w', encoding='utf-8'), indent=1)

    kept, rejected = [], []
    for r in rows:
        c = cache.get(norm_company(r['Company name']), {})
        if c.get('industry'):
            r['Industry'], r['Industry source'] = c['industry'], c['source']
            r['Company size'] = c.get('size') or r.get('Company size', '')
        if r['Industry']:
            if BAD_INDUSTRY.search(r['Industry']) or (FILTER_BY_SEGMENT_INDUSTRY and not industry_fits(r['Segment'], r['Industry'])):
                rejected.append(r['Profile URL'])
                continue
        elif DROP_UNVERIFIED and norm_company(r['Company name']) in cache:
            rejected.append(r['Profile URL'])
            continue
        if r['Segment'] == 'C':
            n = first_number(r['Company size'])
            if n is not None and n < 11:
                rejected.append(r['Profile URL'])
                continue
        kept.append(r)

    if os.path.exists(path + '.bak'):
        os.remove(path + '.bak')
    os.replace(path, path + '.bak')
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows({k: r.get(k, '') for k in COLUMNS} for r in kept)
    if rejected:
        with open(REJECTED_FILE, 'a', encoding='utf-8') as f:
            f.write('\n'.join(u.lower() for u in rejected) + '\n')
    verified = sum(1 for r in kept if r['Industry'])
    print(f'Enrich done: kept {len(kept)} ({verified} with verified industry, {len(kept) - verified} blank), '
          f'dropped {len(rejected)} (industry/size mismatch). Backup: {path}.bak')


def read_csv_rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def dedupe_csv(path):
    """Remove duplicate profile URLs from an existing file (keeps the first)."""
    rows = read_csv_rows(path)
    uniq, seen = [], set()
    for r in rows:
        k = r['Profile URL'].lower().rstrip('/')
        if k and k not in seen:
            seen.add(k)
            uniq.append(r)
    if len(uniq) != len(rows):
        with open(path, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows({k: r.get(k, '') for k in COLUMNS} for r in uniq)
        print(f'Removed {len(rows) - len(uniq)} duplicate rows from {path}')
    return uniq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--segments', default=','.join(RUN_SEGMENTS))
    ap.add_argument('--regions', default=','.join(RUN_REGIONS))
    ap.add_argument('--target', type=int, default=TARGET_PROFILES)
    ap.add_argument('--out', default=OUT_FILE)
    ap.add_argument('--enrich-only', action='store_true', help='only (re)verify industry in an existing CSV')
    ap.add_argument('--no-enrich', action='store_true', help='collect only, skip industry verification')
    ap.add_argument('--debug', action='store_true', help='print why each result was kept or skipped')
    ap.add_argument('--reset', action='store_true', help='forget progress and start from scratch (keeps the CSV)')
    args = ap.parse_args()
    global DEBUG
    DEBUG = args.debug

    if args.reset:
        for f in (DONE_FILE, REJECTED_FILE):
            if os.path.exists(f):
                os.remove(f)
        print('Progress reset.')

    rows = dedupe_csv(args.out)
    if args.enrich_only:
        enrich_csv(args.out)
        return

    jobs = build_jobs(args.segments.split(','), args.regions.split(','), PAGES)

    # ---- restore state from disk: nothing already done is repeated ----
    seen = {r['Profile URL'].lower().rstrip('/') for r in rows}
    if os.path.exists(REJECTED_FILE):
        seen |= {l.strip().rstrip('/') for l in open(REJECTED_FILE, encoding='utf-8') if l.strip()}
    counts = {}
    for r in rows:   # rebuild the "max 5 per company" counters
        if r['Segment'] == 'B' and r['Contact type'] != 'CXO':
            ck = f"{r['Region']}|{re.sub(r'[^a-z0-9]', '', r['Company name'].lower())}"
            counts[ck] = counts.get(ck, 0) + 1
    done = set()
    if os.path.exists(DONE_FILE):
        done = {l.strip() for l in open(DONE_FILE, encoding='utf-8') if l.strip()}
    total = len(rows)

    pending = [(i, j) for i, j in enumerate(jobs, 1) if j['search_used'] not in done]
    print(f'{len(jobs)} searches planned | {len(jobs) - len(pending)} already done | {len(pending)} remaining')
    print(f'{total} profiles already in {args.out} (target {args.target})')

    new_file = not os.path.exists(args.out)
    fh = open(args.out, 'a', newline='', encoding='utf-8-sig')
    writer = csv.DictWriter(fh, fieldnames=COLUMNS)
    if new_file:
        writer.writeheader()
    done_fh = open(DONE_FILE, 'a', encoding='utf-8')

    def task(job, idx):
        order = ENGINES[idx % len(ENGINES):] + ENGINES[:idx % len(ENGINES)]
        res = run_search(job['query'], job['page'], order)
        time.sleep(random.uniform(*DELAY_RANGE))
        return res

    ex = ThreadPoolExecutor(max_workers=WORKERS)
    n_done = 0
    try:
        CHUNK = WORKERS * 4
        for start in range(0, len(pending), CHUNK):
            if total >= args.target:
                break
            futs = {ex.submit(task, j, i): j for i, j in pending[start:start + CHUNK]}
            for fut in as_completed(futs):
                job = futs[fut]
                results = fut.result()
                if results is None:
                    print(f"   FAILED (will retry next run): {job['search_used']}")
                    continue
                if total >= args.target:      # target already hit: leave this search un-done so a later, bigger run does it
                    continue
                added = 0
                for r in results:
                    parsed = parse_result(r)
                    row = accept(parsed, job, seen, counts)
                    if DEBUG:
                        print('     ', 'KEEP  ' if row else f'SKIP[{REASON}]', '|', r.get('title', '')[:70], '|', r.get('url', '')[:60])
                    if row and total < args.target:
                        writer.writerow(row)
                        total += 1
                        added += 1
                fh.flush()
                os.fsync(fh.fileno())
                done_fh.write(job['search_used'] + '\n')      # checkpoint AFTER rows are safely saved
                done_fh.flush()
                n_done += 1
                print(f"[{len(jobs) - len(pending) + n_done}/{len(jobs)}] {job['search_used']}: "
                      f"{len(results)} results, +{added} (total {total})")
        ex.shutdown()
    except KeyboardInterrupt:
        print('\nStopping (finishing in-flight searches) - progress is saved; run again to continue.')
        ex.shutdown(wait=False, cancel_futures=True)
    finally:
        fh.close()
        done_fh.close()
    print(f'Collected {total} profiles in {args.out}')
    if not args.no_enrich:
        enrich_csv(args.out)


if __name__ == '__main__':
    main()
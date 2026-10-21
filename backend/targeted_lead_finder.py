#!/usr/bin/env python3
"""
Targeted lead finder  -  extends your linkedin_profile_collector.py (keep that file in the same folder).

INPUTS : industry, country / state / city, company size, limit (+ optional discovery keywords)
OUTPUT : leads.csv (+ leads.xlsx)  with, per company that matches ALL inputs:
         Company name | Company website | Company LinkedIn URL | Industry | Company size | Headquarters |
         Decision maker name | title | LinkedIn URL | confidence | other decision makers

HOW IT WORKS (nothing is guessed - a field that cannot be verified is left BLANK)
  1. DISCOVER  candidate companies with the same search engines as your script (DuckDuckGo + Bing):
               a) site:linkedin.com/company "<keyword>" "<city/state>"
               b) site:linkedin.com/in "<location>" "<keyword>" (<owner/CEO titles>)  -> company names
  2. VERIFY    each company's own LinkedIn data: Industry, Company size, Headquarters, Website
               (search-result text -> public company page -> optional Apify actor, as in your script).
               A company is kept ONLY if industry AND size AND location are all verified AND match.
  3. DECISION MAKER  searched only for companies that passed step 2 (Owner / Founder / CEO / President ...).
               The profile must show the same company name + a decision-maker title in the search result.
  4. STOP      as soon as `limit` complete rows are saved (100 -> 100 rows, 1000 -> 1000 rows).
               If the sources run dry first, it stops and tells you how many it could really verify.

Safe to Ctrl+C and re-run: finished searches (<out>.done), verified companies (targeted_cache.json)
and saved rows are never repeated.

Example:
  python targeted_lead_finder.py --industry "Tobacco Manufacturing" --keywords "tobacco, vape, cigar" \
      --country "United States" --state "New Jersey" --city "Newark" --size "11-50" --limit 100 --out leads.csv
"""
import argparse
import csv
import json
import os
import random
import re
import sys
import threading
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

import requests
from bs4 import BeautifulSoup

try:
    import backend.linkedin_profile_collector as lpc
except ImportError:
    import linkedin_profile_collector as lpc          # your existing script: engines, parsing, caches

# ============================ CONFIG ============================
COMPANY_SEARCH_PAGES = [1, 2, 3]       # result pages per company search
PEOPLE_SEARCH_PAGES = [1, 2]           # result pages per people search
CACHE_FILE = 'targeted_cache.json'     # verified company facts + decision makers (criteria independent)
FETCH_COMPANY_PAGE = True              # try the public LinkedIn company page
DEFAULT_TITLES = ['Owner', 'Co-Owner', 'Proprietor', 'Founder', 'Co-Founder', 'CEO',
                  'Chief Executive Officer', 'President', 'Managing Director', 'MD', 'Director',
                  'Executive Director', 'General Manager', 'COO', 'Chief Operating Officer',
                  'CTO', 'Chief Technology Officer', 'Partner', 'Managing Partner', 'VP', 'Vice President']
# ================================================================

COLUMNS = ['Company name', 'Company website', 'Company LinkedIn URL', 'Industry', 'Company size',
           'Headquarters', 'Decision maker name', 'Decision maker title', 'Decision maker LinkedIn URL',
           'DM confidence', 'Other decision makers', 'Company data source', 'Date collected']

# --------------------------------------------------------------------------- text helpers
def nt(s):
    s = ''.join(c for c in unicodedata.normalize('NFKD', str(s or '')) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', s.lower().replace('&', ' and '))).strip()


def stem(t):
    return t[:-1] if len(t) > 3 and t.endswith('s') and not t.endswith('ss') else t


def has_phrase(hay_norm, phrase_norm):
    return bool(phrase_norm) and re.search(rf'(?<![a-z0-9]){re.escape(phrase_norm)}(?![a-z0-9])', hay_norm) is not None


def split_list(s):
    return [x.strip() for x in re.split(r'[,;\n]+', s or '') if x.strip()]


SUFFIX = {'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'llp', 'lp',
          'plc', 'pllc', 'pc', 'the', 'dba'}
GENERIC_WORDS = {'smoke', 'shop', 'shops', 'store', 'stores', 'vape', 'vapes', 'tobacco', 'cigar', 'cigars',
                 'hookah', 'market', 'mini', 'mart', 'convenience', 'wholesale', 'supply', 'supplies', 'discount',
                 'liquor', 'deli', 'grocery', 'gas', 'station', 'food', 'foods', 'and', 'usa', 'us', 'new', 'best',
                 'smoking', 'mobile', 'express', 'plus', 'city', 'town', 'super', 'one', 'first', 'general'}


def company_phrase(name):
    return ' '.join(t for t in nt(name).split() if t not in SUFFIX)


def display_company(name):
    cleaned = re.sub(
        r"[,\s]+(private\s+limited|pvt\.?\s*ltd\.?|pvt\.?|inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|corporation|company|incorporated)\.?$",
        "",
        str(name or "").strip(),
        flags=re.I,
    ).strip()
    return cleaned or str(name or "").strip()


def same_company(a, b):
    na, nb = lpc.norm_company(a), lpc.norm_company(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    s, l = sorted((na, nb), key=len)
    return len(s) >= 5 and s in l and len(s) / len(l) >= 0.75


def is_generic_name(name):
    toks = company_phrase(name).split()
    return bool(toks) and (all(t in GENERIC_WORDS for t in toks) or (len(toks) == 1 and len(toks[0]) < 4))


# --------------------------------------------------------------------------- geography
US_STATES = {
    'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas', 'CA': 'california', 'CO': 'colorado',
    'CT': 'connecticut', 'DE': 'delaware', 'FL': 'florida', 'GA': 'georgia', 'HI': 'hawaii', 'ID': 'idaho',
    'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa', 'KS': 'kansas', 'KY': 'kentucky', 'LA': 'louisiana',
    'ME': 'maine', 'MD': 'maryland', 'MA': 'massachusetts', 'MI': 'michigan', 'MN': 'minnesota',
    'MS': 'mississippi', 'MO': 'missouri', 'MT': 'montana', 'NE': 'nebraska', 'NV': 'nevada',
    'NH': 'new hampshire', 'NJ': 'new jersey', 'NM': 'new mexico', 'NY': 'new york', 'NC': 'north carolina',
    'ND': 'north dakota', 'OH': 'ohio', 'OK': 'oklahoma', 'OR': 'oregon', 'PA': 'pennsylvania',
    'RI': 'rhode island', 'SC': 'south carolina', 'SD': 'south dakota', 'TN': 'tennessee', 'TX': 'texas',
    'UT': 'utah', 'VT': 'vermont', 'VA': 'virginia', 'WA': 'washington', 'WV': 'west virginia',
    'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district of columbia',
}
STATE_BY_NAME = {v: k for k, v in US_STATES.items()}
COUNTRIES = {   # canonical -> (names used in text, ISO code used in structured data)
    'united states': ({'united states', 'united states of america', 'usa', 'america'}, 'US'),
    'united kingdom': ({'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'uk'}, 'GB'),
    'canada': ({'canada'}, 'CA'), 'india': ({'india'}, 'IN'), 'australia': ({'australia'}, 'AU'),
    'germany': ({'germany', 'deutschland'}, 'DE'), 'france': ({'france'}, 'FR'), 'italy': ({'italy'}, 'IT'),
    'spain': ({'spain'}, 'ES'), 'netherlands': ({'netherlands', 'holland'}, 'NL'), 'ireland': ({'ireland'}, 'IE'),
    'mexico': ({'mexico'}, 'MX'), 'brazil': ({'brazil'}, 'BR'),
    'united arab emirates': ({'united arab emirates', 'uae'}, 'AE'), 'singapore': ({'singapore'}, 'SG'),
    'pakistan': ({'pakistan'}, 'PK'), 'new zealand': ({'new zealand'}, 'NZ'), 'south africa': ({'south africa'}, 'ZA'),
}


def resolve_country(raw):
    n = nt(raw)
    if not n:
        return '', set(), ''
    if n in ('us', 'usa', 'u s', 'u s a'):
        n = 'united states'
    if n in ('uk', 'gb'):
        n = 'united kingdom'
    for canon, (names, code) in COUNTRIES.items():
        if n == canon or n in names:
            return canon, names | {canon}, code
    return n, {n}, ''


INDUSTRY_EXPANSIONS = {
    'saas': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Computer Software', 'Information Technology & Services'],
    'software': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Computer Software'],
    'cloud': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Computer & Network Security', 'Information Technology & Services'],
    'cloud infrastructure': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Computer & Network Security', 'Information Technology & Services'],
    'infrastructure': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Civil Engineering', 'Construction'],
    'ai': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Research Services'],
    'artificial intelligence': ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet', 'Research Services'],
    'fintech': ['Financial Services', 'Software Development', 'Banking', 'IT Services and IT Consulting'],
    'cybersecurity': ['Computer & Network Security', 'Software Development', 'IT Services and IT Consulting', 'Information Technology & Services'],
    'e-commerce': ['Retail', 'Technology, Information and Internet', 'Software Development', 'Internet'],
    'clean energy': ['Renewables & Environment', 'Oil & Energy', 'Utilities', 'Environmental Services'],
    'digital marketing': ['Advertising Services', 'Marketing Services', 'Public Relations and Communications'],
    'logistics': ['Logistics & Supply Chain', 'Transportation, Logistics and Storage', 'Freight and Package Transportation'],
    'tobacco': ['Tobacco Manufacturing', 'Food and Beverage Manufacturing', 'Manufacturing'],
    'manufacturing': ['Manufacturing', 'Machinery Manufacturing', 'Electrical Equipment Electric Parts Manufacturing'],
    'healthcare': ['Hospitals and Health Care', 'Medical Equipment Manufacturing', 'Biotechnology'],
}


@dataclass
class Criteria:
    industries: list                      # LinkedIn industry names / words to verify, e.g. ["Tobacco Manufacturing"]
    keywords: list = field(default_factory=list)   # discovery search terms (default = industries)
    country: str = ''
    state: str = ''
    city: str = ''
    size_min: int = 1
    size_max: Optional[int] = None        # None = no upper bound
    limit: int = 100
    size_mode: str = 'contained'          # 'contained' = LinkedIn size band must lie fully inside your range
    require_dm: bool = True               # only count companies where a decision maker was verified
    titles: list = field(default_factory=lambda: list(DEFAULT_TITLES))

    def __post_init__(self):
        self.keywords = self.keywords or list(self.industries)
        self.city_n = nt(self.city)
        r = self.state.strip()
        if r.upper() in US_STATES:
            self.st_abbr, self.st_full = r.upper(), US_STATES[r.upper()]
        else:
            self.st_abbr, self.st_full = STATE_BY_NAME.get(nt(r), ''), nt(r)
        self.country_canon, self.country_names, self.country_code = resolve_country(self.country)
        if not (self.city or self.state or self.country):
            raise ValueError('Give at least one of country / state / city')
        if not self.industries:
            raise ValueError('Give at least one industry')

        # Map discovery keywords to official LinkedIn industry taxonomies
        exp = []
        for kw in self.keywords + self.industries:
            k_low = nt(kw)
            for map_k, map_vals in INDUSTRY_EXPANSIONS.items():
                if map_k in k_low or k_low in map_k:
                    exp.extend(map_vals)
        if exp:
            self.industries = list(dict.fromkeys(self.industries + exp))

    def signature(self):
        return {'industries': self.industries, 'keywords': self.keywords, 'country': self.country,
                'state': self.state, 'city': self.city, 'size': [self.size_min, self.size_max],
                'size_mode': self.size_mode, 'titles': self.titles}


def parse_size_arg(s):
    """'11-50' | '50+' | '<=50' | 'up to 50' | '10 to 100' | '11-50, 51-200' -> (min, max|None)."""
    t = re.sub(r'(\d),(\d{3})', r'\1\2', str(s or '').lower())      # 1,001 -> 1001
    ranges = [(int(x), int(y)) for x, y in re.findall(r'(\d+)\s*(?:-|\u2013|to)\s*(\d+)', t)]
    if ranges:
        return min(r[0] for r in ranges), max(r[1] for r in ranges)
    m = re.search(r'(\d+)\s*\+', t) or re.search(r'(?:at least|minimum|min|over|>=|>)\s*(\d+)', t)
    if m:
        return int(m.group(1)), None
    m = re.search(r'(?:up to|maximum|max|under|<=|<)\s*(\d+)', t)
    if m:
        return 1, int(m.group(1))
    raise ValueError(f"Could not read company size '{s}'. Use e.g. 11-50, 50+, <=200")


def parse_size_text(text, need_word=True):
    """LinkedIn size text -> (lo, hi|None) or None.  '11-50 employees', '10,001+ employees'."""
    t = re.sub(r'(\d),(\d{3})', r'\1\2', str(text or ''))
    w = r'\s*employees' if need_word else ''
    m = re.search(rf'(\d+)\s*(?:-|\u2013|to)\s*(\d+){w}', t, re.I)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(rf'(\d+)\s*\+{w}', t, re.I)
    if m:
        return int(m.group(1)), None
    return None


def size_ok(rng, crit):
    if not rng:
        return False
    lo, hi = rng
    cmax = crit.size_max
    if crit.size_mode == 'overlap':
        return (hi is None or hi >= crit.size_min) and (cmax is None or lo <= cmax)
    return lo >= crit.size_min and (cmax is None or (hi is not None and hi <= cmax))


def industry_ok(industry, crit):
    ind = ' '.join(stem(t) for t in nt(industry).split())
    for phrase in crit.industries:
        toks = [stem(t) for t in nt(phrase).split() if t not in ('and', 'of', 'the')]
        if toks and all(has_phrase(ind, t) for t in toks):
            return True
    return False


def location_ok(info, crit):
    hq = info.get('hq') or ''
    if not hq:
        return False, 'headquarters not verified'
    hq_n = nt(hq)
    if crit.city and not has_phrase(hq_n, crit.city_n):
        return False, f'HQ city differs ({hq})'
    state_hit = False
    if crit.state:
        state_hit = bool((crit.st_full and has_phrase(hq_n, crit.st_full)) or
                         (crit.st_abbr and re.search(rf'\b{crit.st_abbr}\b', hq)))
        if not state_hit:
            return False, f'HQ state differs ({hq})'
    if crit.country:
        confirmed = any(has_phrase(hq_n, n) for n in crit.country_names) or \
            (crit.country_code and info.get('country_code', '').upper() == crit.country_code)
        if not confirmed and crit.country_canon == 'united states':
            confirmed = state_hit or any(has_phrase(hq_n, v) for v in US_STATES.values()) or \
                bool(re.search(r'\b(' + '|'.join(US_STATES) + r')\b', hq))
        if not confirmed:        # infer from city/state only if no OTHER country is named
            other = any(has_phrase(hq_n, n) for c, (names, _) in COUNTRIES.items()
                        if c != crit.country_canon for n in names)
            code_other = info.get('country_code') and crit.country_code and info['country_code'].upper() != crit.country_code
            confirmed = (state_hit or bool(crit.city)) and not other and not code_other
        if not confirmed:
            return False, f'HQ country not confirmed ({hq})'
    return True, ''


def evaluate_company(info, crit):
    if not info or not info.get('industry'):
        return False, 'industry not verified'
    if not industry_ok(info['industry'], crit):
        return False, f"industry mismatch ({info['industry']})"
    rng = info.get('size_range')
    if not rng:
        return False, 'company size not verified'
    if not size_ok(rng, crit):
        return False, f"size mismatch ({info.get('size_text')})"
    return location_ok(info, crit)


# --------------------------------------------------------------------------- LinkedIn company data
_fail = 0
_lock = threading.Lock()


def new_info():
    return {'slug': '', 'li_name': '', 'url': '', 'industry': '', 'size_text': '', 'size_range': None,
            'hq': '', 'country_code': '', 'website': '', 'source': '', 'page_tried': False, 'apify_tried': False,
            'ambiguous': False}


def clean_website(u):
    u = str(u or '').strip()
    if not u:
        return ''
    if not re.match(r'https?://', u, re.I):
        u = 'http://' + u
    host = re.sub(r'^www\.', '', (re.match(r'https?://([^/?#]+)', u, re.I) or [None, ''])[1].lower())
    if not host or '.' not in host or any(x in host for x in ('linkedin.com', 'facebook.com', 'instagram.com')):
        return ''
    return re.split(r'[?#]', u)[0].rstrip('/')


def parse_company_page(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = {'industry': '', 'size_text': '', 'hq': '', 'website': '', 'country_code': ''}
    labels = {'industry': 'industry', 'company size': 'size_text', 'headquarters': 'hq', 'website': 'website'}
    for dt in soup.find_all('dt'):
        key = labels.get(dt.get_text(' ', strip=True).lower())
        dd = dt.find_next('dd')
        if key and dd and not out[key]:
            a = dd.find('a', href=True) if key == 'website' else None
            out[key] = (a['href'] if a else dd.get_text(' ', strip=True)).strip()
    for sel, key in (('[data-test-id="about-us__industry"] dd', 'industry'), ('[data-test-id="about-us__size"] dd', 'size_text'),
                     ('[data-test-id="about-us__headquarters"] dd', 'hq')):
        el = soup.select_one(sel)
        if el and not out[key]:
            out[key] = el.get_text(' ', strip=True)
    for sc in soup.find_all('script', attrs={'type': 'application/ld+json'}):      # structured address, if present
        try:
            data = json.loads(sc.string or '')
        except Exception:
            continue
        items = data.get('@graph', [data]) if isinstance(data, dict) else data
        for it in items if isinstance(items, list) else []:
            addr = it.get('address') if isinstance(it, dict) else None
            if isinstance(addr, dict):
                ctry = str(addr.get('addressCountry') or '')
                if len(ctry) == 2 and not out['country_code']:
                    out['country_code'] = ctry.upper()
                if not out['hq']:
                    out['hq'] = ', '.join(str(addr.get(k)) for k in ('addressLocality', 'addressRegion', 'addressCountry')
                                          if addr.get(k))
    out['website'] = clean_website(out['website'])
    return out


def fetch_page(slug):
    global _fail
    with _lock:
        if _fail >= 5:                      # LinkedIn keeps blocking: stop hammering it
            return None
    try:
        r = requests.get(f'https://www.linkedin.com/company/{slug}/', timeout=30,
                         headers={'User-Agent': random.choice(lpc.UA), 'Accept-Language': 'en-US,en;q=0.9'})
        ok = r.status_code == 200 and 'authwall' not in r.url
    except Exception:
        ok, r = False, None
    parsed = parse_company_page(r.text) if ok else None
    with _lock:
        _fail = 0 if parsed and (parsed['industry'] or parsed['hq']) else _fail + 1
    return parsed


def apply_fields(info, d, source):
    """Fill ONLY empty fields; remember where the data came from."""
    changed = False
    for k in ('industry', 'hq', 'website', 'country_code'):
        if d.get(k) and not info[k]:
            info[k] = d[k]
            changed = True
    if d.get('size_text') and not info['size_range']:
        rng = parse_size_text(d['size_text'], need_word=False)
        if rng:
            info['size_text'], info['size_range'] = d['size_text'], list(rng)
            changed = True
    if changed and source not in info['source']:
        info['source'] = (info['source'] + ' + ' if info['source'] else '') + source


def snippet_fields(text):
    ind, size = lpc.parse_company_text(text)
    hq = re.search(r'Headquarters:?\s*([A-Z][^\u00b7|\n]{2,60}?)(?=\s*(?:[.\u00b7|\n]|Founded|Company size|Industry|$))', text or '')
    return {'industry': ind, 'size_text': size, 'hq': hq.group(1).strip() if hq else ''}


def li_title_name(title):
    t = re.sub(r'\s*[|\-\u2013]\s*LinkedIn.*$', '', str(title or ''), flags=re.I)
    return re.split(r'\s+\|\s+|\s+[-\u2013]\s+', t)[0].strip()


def find_company_page(name, crit, order):
    """-> (slug, li_name, snippet_text, ambiguous, failed)"""
    loc = crit.city or crit.state or ''
    res = lpc.run_search(f'site:linkedin.com/company "{display_company(name)}" {loc}'.strip(), 1, order,
                         must=r'linkedin\.com/company/')
    if res is None:
        return '', '', '', False, True
    hits = {}
    for x in res:
        m = re.search(r'linkedin\.com/company/([^/?#]+)', x.get('url', ''), re.I)
        nm = li_title_name(x.get('title', ''))
        if m and same_company(nm, name):
            hits.setdefault(m.group(1).lower(), (nm, f"{x.get('title', '')} . {x.get('snippet', '')}"))
    if not hits:
        return '', '', '', False, False
    if len(hits) > 1:        # prefer the page whose text mentions our city/state
        pref = [s for s, (_, t) in hits.items() if (crit.city_n and has_phrase(nt(t), crit.city_n)) or
                (crit.st_full and has_phrase(nt(t), crit.st_full))]
        if len(pref) == 1:
            hits = {pref[0]: hits[pref[0]]}
        else:
            return '', '', '', True, False
    slug, (nm, text) = next(iter(hits.items()))
    return slug, nm, text, False, False


def get_company_info(cand, cache, crit, idx):
    """Runs in a worker thread. Returns (info, retry_later)."""
    ent = cache.get(lpc.norm_company(cand['name']), {})
    info = ent.get('info') or new_info()
    done = lambda: info['industry'] and info['size_range'] and info['hq']
    if done():
        return info, False
    order = lpc.ENGINES[idx % len(lpc.ENGINES):] + lpc.ENGINES[:idx % len(lpc.ENGINES)]
    if not info['slug'] and not info['ambiguous']:
        if cand.get('slug'):
            info['slug'], info['li_name'] = cand['slug'], cand.get('li_name', '')
            apply_fields(info, snippet_fields(cand.get('snippet', '')), 'LinkedIn (search result)')
        else:
            slug, nm, text, amb, failed = find_company_page(cand['name'], crit, order)
            if failed:
                return info, True
            info.update(slug=slug, li_name=nm, ambiguous=amb)
            if slug:
                apply_fields(info, snippet_fields(text), 'LinkedIn (search result)')
            time.sleep(random.uniform(*lpc.DELAY_RANGE))
    if info['slug']:
        info['url'] = f"https://www.linkedin.com/company/{info['slug']}"
        if not done() and FETCH_COMPANY_PAGE and not info['page_tried']:
            d = fetch_page(info['slug'])
            if d is not None:
                info['page_tried'] = True
                apply_fields(info, d, 'LinkedIn (company page)')
            time.sleep(random.uniform(*lpc.DELAY_RANGE))
    return info, False


def _first(o, keys):
    for k in keys:
        v = o.get(k)
        if v:
            return v
    return ''


def apify_batch(infos):
    """Optional: fill what is still missing from the Apify actor your script already uses.
    NOTE: output field names below are best-effort guesses - check a few results by hand."""
    todo = [i for i in infos if i['slug'] and not (i['industry'] and i['size_range'] and i['hq']) and not i['apify_tried']]
    if not lpc.APIFY_TOKEN or not todo:
        return
    for k in range(0, len(todo), 25):
        batch = todo[k:k + 25]
        urls = [f"https://www.linkedin.com/company/{i['slug']}" for i in batch]
        try:
            r = requests.post(f'https://api.apify.com/v2/acts/{lpc.APIFY_ACTOR}/run-sync-get-dataset-items',
                              params={'token': lpc.APIFY_TOKEN}, json={'companyUrls': urls, 'maxCompanies': len(urls)},
                              timeout=320)
            items = r.json() if r.ok else []
        except Exception as e:
            print('  apify error:', e)
            items = []
        by = {}
        for o in items if isinstance(items, list) else []:
            m = re.search(r'company/([^/?#]+)', str(o.get('linkedinUrl') or o.get('canonicalUrl') or o.get('url') or
                                                    o.get('inputUrl') or ''), re.I)
            if m:
                by[m.group(1).lower()] = o
        for i in batch:
            i['apify_tried'] = True
            o = by.get(i['slug'])
            if not o:
                continue
            hq = _first(o, ['headquarters', 'headquarter', 'hq', 'location'])
            if isinstance(hq, dict):
                hq = ', '.join(str(hq.get(k)) for k in ('city', 'geographicArea', 'state', 'country') if hq.get(k))
            elif isinstance(hq, list):
                hq = str(hq[0]) if hq else ''
            apply_fields(i, {'industry': lpc._apify_industry(o), 'size_text': lpc._apify_size(o),
                             'hq': str(hq or ''), 'website': clean_website(_first(o, ['website', 'websiteUrl', 'companyWebsite']))},
                         'LinkedIn (Apify)')


# --------------------------------------------------------------------------- decision makers
def title_rank(text, titles):
    t = f' {nt(text)} '
    t = re.sub(r'\bmd\b', 'managing director', t)
    t = re.sub(r'\bceo\b', 'chief executive officer', t)
    t = re.sub(r'\bcoo\b', 'chief operating officer', t)
    t = re.sub(r'\bcto\b', 'chief technology officer', t)
    t = t.replace(' vice president ', ' vp ').replace(' assistant to the president ', ' ')
    best = None
    for i, ti in enumerate(titles):
        ti_norm = nt(ti)
        if ti_norm in ('md', 'ceo', 'coo', 'cto'):
            continue
        if f' {ti_norm} ' in t:
            best = i if best is None else min(best, i)
    return best


def person_location_status(snippet, crit):
    m = re.search(r'Location:\s*([^\u00b7|]+)', snippet or '')
    if not m or not (crit.city or crit.state):
        return 'unknown'
    loc_n = nt(m.group(1))
    if crit.city_n and has_phrase(loc_n, crit.city_n):
        return 'match'
    if crit.st_full and has_phrase(loc_n, crit.st_full):
        return 'match'
    if crit.st_abbr and re.search(rf'\b{crit.st_abbr}\b', m.group(1)):
        return 'match'
    return 'conflict'


def eval_dm(r, names, crit, generic):
    parsed = lpc.parse_result(r)
    if not parsed:
        return None
    toks = nt(parsed['full_name']).split()
    if len(toks) < 2 or {'linkedin', 'profile', 'profiles'} & set(toks):
        return None
    slug = re.search(r'linkedin\.com/in/([^/?#]+)', parsed['profile_url'], re.I)
    if not slug:
        return None
    head = re.sub(r'\s*[|\-\u2013]\s*LinkedIn\s*$', '', str(r.get('title') or ''), flags=re.I)
    after = ' - '.join(re.split(r'\s+[-\u2013]\s+', head)[1:])
    if lpc.BAD_TITLE.search(head) or re.search(r'\b(former|ex)\b', after, re.I):
        return None
    snippet = str(r.get('snippet') or '')
    exp = re.search(r'Experience:\s*([^\u00b7|]+)', snippet, re.I)
    hay = nt(after + ' ' + (exp.group(1) if exp else '') + ' ' + (parsed['company'] or ''))
    how = ''
    if parsed['company'] and any(same_company(parsed['company'], n) for n in names):
        how = 'field'
    elif any(has_phrase(hay, company_phrase(n)) for n in names if company_phrase(n)):
        how = 'text'
    if not how:
        return None
    rank = title_rank(parsed['title'] or after, crit.titles)
    if rank is None:
        return None
    loc = person_location_status(snippet, crit)
    if generic and loc != 'match':
        return None                       # generic company names need a matching location to be trusted
    conf = 'High' if how == 'field' and loc == 'match' else ('Medium' if loc != 'conflict' else 'Low (location differs)')
    clean_url = lpc.clean_linkedin_url(parsed['profile_url'], parsed['full_name'], parsed['company'])
    return {'name': parsed['full_name'], 'title': parsed['title'] or after.split(' - ')[0],
            'url': clean_url, 'rank': rank, 'conf': conf,
            'loc': loc}


def find_decision_makers(cand_name, info, crit, idx):
    """-> (list of DMs best-first, retry_later)"""
    names = [n for n in (cand_name, info.get('li_name')) if n]
    disp = display_company(cand_name)
    if disp not in names:
        names.append(disp)
    generic = is_generic_name(cand_name)
    loc = crit.city or crit.state or crit.country

    queries = [
        f'site:linkedin.com/in "{disp}" "Director"',
        f'site:linkedin.com/in "{disp}" "CEO"',
        f'site:linkedin.com/in "{disp}" "Founder"',
        f'site:linkedin.com/in "{disp}" "MD"',
        f'site:linkedin.com/in "{disp}" "{loc}"' if loc else None,
        f'site:linkedin.com/in "{disp}"',
    ]
    if cand_name != disp:
        queries.append(f'site:linkedin.com/in "{cand_name}"')
    queries = [q for q in queries if q]

    order = lpc.ENGINES[idx % len(lpc.ENGINES):] + lpc.ENGINES[:idx % len(lpc.ENGINES)]
    failed = False
    for q in queries:
        res = lpc.run_search(q, 1, order)
        time.sleep(random.uniform(*lpc.DELAY_RANGE))
        if res is None:
            failed = True
            continue
        found = {}
        for pos, r in enumerate(res):
            d = eval_dm(r, names, crit, generic)
            if d and (d['url'] not in found or d['rank'] < found[d['url']]['rank']):
                d['pos'] = pos
                found[d['url']] = d
        if found:
            conf_order = {'High': 0, 'Medium': 1}
            return sorted(found.values(), key=lambda d: (conf_order.get(d['conf'], 2), d['rank'], d['pos'])), False
    return [], failed


# --------------------------------------------------------------------------- discovery
def build_jobs(crit):
    locs = [x for x in (crit.city, crit.state) if x] or [crit.country]
    tq = ' OR '.join(f'"{t}"' if ' ' in t or '-' in t else t for t in crit.titles)
    jobs = []
    for page in sorted(set(COMPANY_SEARCH_PAGES + PEOPLE_SEARCH_PAGES)):
        for kw in crit.keywords:
            if page in COMPANY_SEARCH_PAGES:
                for loc in locs:
                    jobs.append({'kind': 'company', 'page': page, 'key': f'company|{kw}|{loc}|p{page}',
                                 'q': f'site:linkedin.com/company "{kw}" "{loc}"'})
            if page in PEOPLE_SEARCH_PAGES:
                jobs.append({'kind': 'people', 'page': page, 'key': f'people|{kw}|{locs[0]}|p{page}',
                             'q': f'site:linkedin.com/in "{locs[0]}" "{kw}"'})
    return jobs


def candidates_from(job, results):
    out = []
    for x in results:
        if job['kind'] == 'company':
            m = re.search(r'linkedin\.com/company/([^/?#]+)', x.get('url', ''), re.I)
            nm = li_title_name(x.get('title', ''))
            if m and nm:
                out.append({'name': nm, 'slug': m.group(1).lower(), 'li_name': nm,
                            'snippet': f"{x.get('title', '')} . {x.get('snippet', '')}"})
        else:
            p = lpc.parse_result(x)
            if p and p['company']:
                out.append({'name': p['company'], 'slug': '', 'snippet': ''})
    return [c for c in out if len(lpc.norm_company(c['name'])) >= 3]


# --------------------------------------------------------------------------- output
def read_rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def export_xlsx(csv_path):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
    except ImportError:
        print('openpyxl not installed (pip install openpyxl) - skipped the .xlsx export')
        return None
    rows = read_rows(csv_path)
    wb = Workbook()
    ws = wb.active
    ws.title = 'Leads'
    ws.append(COLUMNS)
    for c in ws[1]:
        c.font, c.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='1F3864')
    urlcols = {COLUMNS.index(c) + 1 for c in ('Company website', 'Company LinkedIn URL', 'Decision maker LinkedIn URL')}
    for r in rows:
        ws.append([r.get(c) or None for c in COLUMNS])
        for j in urlcols:
            cell = ws.cell(row=ws.max_row, column=j)
            if cell.value:
                cell.hyperlink = cell.value
                cell.font = Font(color='0563C1', underline='single')
    for j, c in enumerate(COLUMNS, 1):
        ws.column_dimensions[ws.cell(row=1, column=j).column_letter].width = min(max(len(c) + 2, 18), 48)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions
    out = os.path.splitext(csv_path)[0] + '.xlsx'
    wb.save(out)
    return out


def _load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def load_cache():
    return _load_json(CACHE_FILE) if os.path.exists(CACHE_FILE) else {}


def save_cache(cache):
    tmp = CACHE_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=1)
    os.replace(tmp, CACHE_FILE)


# --------------------------------------------------------------------------- main run
def run(crit, out_csv='leads.csv', workers=None, export=True, on_event=None, stop_event=None):
    workers = workers or lpc.WORKERS
    sig_path = out_csv + '.criteria.json'
    if os.path.exists(sig_path) and _load_json(sig_path) != json.loads(json.dumps(crit.signature())):
        print(f'{out_csv} was started with different criteria. Resetting signature for fresh criteria.')
    with open(sig_path, 'w') as f:
        json.dump(crit.signature(), f)

    cache = load_cache()
    rows = read_rows(out_csv)
    seen = {lpc.norm_company(r['Company name']) for r in rows}
    total = len(rows)
    done_path = out_csv + '.done'
    done = set()
    if os.path.exists(done_path):
        with open(done_path, encoding='utf-8') as f:
            done = {l.strip() for l in f}
    rejects = Counter()
    jobs = [j for j in build_jobs(crit) if j['key'] not in done]
    print(f'{total}/{crit.limit} rows already saved | {len(jobs)} searches remaining')

    if on_event:
        on_event({
            'type': 'status_update',
            'message': f'{total}/{crit.limit} rows already saved | {len(jobs)} searches queued',
            'totalCollected': total,
            'target': crit.limit,
        })

    new_file = not os.path.exists(out_csv)
    fh = open(out_csv, 'a', newline='', encoding='utf-8-sig')
    writer = csv.DictWriter(fh, fieldnames=COLUMNS)
    if new_file:
        writer.writeheader()
    done_fh = open(done_path, 'a', encoding='utf-8')
    rej_fh = open(out_csv + '.rejected.csv', 'a', newline='', encoding='utf-8-sig')
    rej_w = csv.writer(rej_fh)
    ex = ThreadPoolExecutor(max_workers=workers)

    def search_job(args):
        i, job = args
        order = lpc.ENGINES[i % len(lpc.ENGINES):] + lpc.ENGINES[:i % len(lpc.ENGINES)]
        if on_event:
            on_event({
                'type': 'query_start',
                'query': job['q'],
                'engine': order[0],
                'kind': job['kind'],
            })
        res = lpc.run_search(job['q'], job['page'], order, must=r'linkedin\.com/(company|in)/')
        time.sleep(random.uniform(*lpc.DELAY_RANGE))
        return res

    try:
        for start in range(0, len(jobs), workers * 2):
            if total >= crit.limit or (stop_event and stop_event.is_set()):
                break
            batch = jobs[start:start + workers * 2]
            results = list(ex.map(search_job, list(enumerate(batch))))
            cands = []
            for job, res in zip(batch, results):
                if res is None:
                    print(f"   search failed, will retry next run: {job['key']}")
                    continue
                for c in candidates_from(job, res):
                    k = lpc.norm_company(c['name'])
                    if k not in seen:
                        seen.add(k)
                        cands.append(c)
                done_fh.write(job['key'] + '\n')
                done_fh.flush()
            print(f'[{min(start + len(batch), len(jobs))}/{len(jobs)}] {len(cands)} new candidate companies')

            for s in range(0, len(cands), workers * 4):
                if total >= crit.limit or (stop_event and stop_event.is_set()):
                    break
                chunk = cands[s:s + workers * 4]
                # A) company data (parallel)
                got = list(ex.map(lambda a: get_company_info(a[1], cache, crit, a[0]), list(enumerate(chunk))))
                infos = [g[0] for g in got]
                apify_batch(infos)                                           # B) optional Apify
                passed = []
                for c, (info, retry) in zip(chunk, got):
                    k = lpc.norm_company(c['name'])
                    if retry:
                        seen.discard(k)                                      # engines failed -> try again next run
                        continue
                    cache.setdefault(k, {})['info'] = info
                    ok, why = evaluate_company(info, crit)                   # C) ALL criteria must match
                    if not ok:
                        rejects[why.split(' (')[0]] += 1
                        rej_w.writerow([c['name'], why, info.get('url', '')])
                        continue
                    passed.append((c, info))
                rej_fh.flush()
                # D) decision makers - only for companies that passed (parallel)
                def dm_task(a):
                    i, (c, info) = a
                    ent = cache.get(lpc.norm_company(c['name']), {})
                    if ent.get('dm') is not None:
                        return ent['dm'], False
                    return find_decision_makers(c['name'], info, crit, i)
                dms = list(ex.map(dm_task, list(enumerate(passed))))
                for (c, info), (dm, retry) in zip(passed, dms):
                    k = lpc.norm_company(c['name'])
                    if retry and not dm:
                        seen.discard(k)
                        continue
                    cache[k]['dm'] = dm
                    if not dm and crit.require_dm:
                        rejects['no verified decision maker'] += 1
                        rej_w.writerow([c['name'], 'no verified decision maker', info.get('url', '')])
                        continue
                    if total >= crit.limit or (stop_event and stop_event.is_set()):
                        break
                    top = dm[0] if dm else {}
                    others = '; '.join(f"{d['name']} ({d['title']}) {d['url']}" for d in dm[1:3])
                    row_data = {
                        'Company name': info.get('li_name') or c['name'], 'Company website': info['website'],
                        'Company LinkedIn URL': info['url'], 'Industry': info['industry'],
                        'Company size': info['size_text'], 'Headquarters': info['hq'],
                        'Decision maker name': top.get('name', ''), 'Decision maker title': top.get('title', ''),
                        'Decision maker LinkedIn URL': top.get('url', ''), 'DM confidence': top.get('conf', ''),
                        'Other decision makers': others, 'Company data source': info['source'],
                        'Date collected': time.strftime('%Y-%m-%d')}
                    writer.writerow(row_data)
                    total += 1
                    fh.flush()
                    os.fsync(fh.fileno())

                    if on_event:
                        on_event({
                            'type': 'profile_found',
                            'profile': {
                                **row_data,
                                'Full name': row_data['Decision maker name'] or row_data['Company name'],
                                'Title': row_data['Decision maker title'] or 'Executive',
                                'Profile URL': row_data['Decision maker LinkedIn URL'] or row_data['Company LinkedIn URL'],
                                'Location': row_data['Headquarters'],
                                'Contact type': row_data['DM confidence'] or 'Verified Lead',
                            },
                            'collectedCount': total,
                            'target': crit.limit,
                        })

                save_cache(cache)
                print(f'   saved {total}/{crit.limit}')
    except KeyboardInterrupt:
        print('\nStopped - progress saved; run the same command again to continue.')
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
        for f in (fh, done_fh, rej_fh):
            f.close()
        save_cache(cache)

    print(f'\nDONE: {total} rows in {out_csv} (requested {crit.limit}).')
    if total < crit.limit:
        print('Fewer than requested: the search sources ran out of companies that match EVERY condition and '
              'could be verified. Nothing was padded or guessed.')
    if rejects:
        print('Companies dropped, by reason:', dict(rejects.most_common()))
    if export:
        x = export_xlsx(out_csv)
        if x:
            print('Excel file:', x)
    if on_event:
        on_event({
            'type': 'completed',
            'message': f'Completed: {total} verified rows collected matching all criteria.',
            'totalCollected': total,
            'target': crit.limit,
        })
    return total


def main():
    ap = argparse.ArgumentParser(description='Find companies matching ALL criteria + their decision makers.')
    ap.add_argument('--industry', required=True, help='LinkedIn industry name(s) to verify, comma separated')
    ap.add_argument('--keywords', default='', help='extra discovery search words (default: the industry names)')
    ap.add_argument('--country', default='')
    ap.add_argument('--state', default='')
    ap.add_argument('--city', default='')
    ap.add_argument('--size', required=True, help='employees, e.g. 11-50 | 50+ | <=200')
    ap.add_argument('--size-mode', choices=['contained', 'overlap'], default='contained',
                    help="contained = LinkedIn's size band must be fully inside your range (default)")
    ap.add_argument('--limit', type=int, required=True, help='stop after this many saved rows')
    ap.add_argument('--out', default='leads.csv')
    ap.add_argument('--titles', default='', help='decision-maker titles, comma separated')
    ap.add_argument('--allow-no-dm', action='store_true', help='also save companies where no decision maker was verified')
    ap.add_argument('--workers', type=int, default=None)
    a = ap.parse_args()
    lo, hi = parse_size_arg(a.size)
    industries = split_list(a.industry)
    crit = Criteria(industries=industries, keywords=split_list(a.keywords) or industries, country=a.country,
                    state=a.state, city=a.city, size_min=lo, size_max=hi, limit=a.limit, size_mode=a.size_mode,
                    require_dm=not a.allow_no_dm, titles=split_list(a.titles) or list(DEFAULT_TITLES))
    run(crit, a.out, workers=a.workers)


if __name__ == '__main__':
    main()

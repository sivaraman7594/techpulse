#!/usr/bin/env python3
"""TechPulse fetcher.

Reads sources.json, pulls every source that is due, merges the results with the
previously published data and writes site/data/*.json for the app.
Standard library only, so it runs anywhere Python 3.11+ is available.

Environment (all optional):
  PREVIOUS_DATA_URL  live site's data/ URL to merge with (set by the workflow)
  GITHUB_TOKEN       higher GitHub API rate limits
  ADZUNA_APP_ID / ADZUNA_APP_KEY   enables the Adzuna job source
  NTFY_TOPIC         sends push alerts to the ntfy app
  STACKEXCHANGE_KEY  raises the Stack Overflow API quota (300 → 10,000 requests/day)
  FORCE_ALL=1        fetch every source regardless of its schedule
"""
import gzip
import hashlib
import html
import json
import os
import re
import sys
import textwrap
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "site", "data")
UA = "Mozilla/5.0 (compatible; TechPulseBot/1.0)"
NOW = datetime.now(timezone.utc)
ENV = os.environ.get

NEWS_KEEP_DAYS = 10
NEWS_MAX = 3000
JOBS_KEEP_DAYS = 45
JOBS_MAX = 6000
FROM_NEWS_KEEP_DAYS = 60

with open(os.path.join(ROOT, "sources.json"), encoding="utf-8") as f:
    CFG = json.load(f)


def rx(words):
    return re.compile("|".join(f"(?:{w})" for w in words), re.I) if words else None


CAT_RX = [(c["id"], rx(c["keywords"])) for c in CFG["categories"]]
OPP_RX = [(k, rx(v)) for k, v in CFG.get("opportunity_keywords", {}).items()]
JOB_TITLE_RX = re.compile(CFG["job_title_filter"], re.I)
INDIA_RX = re.compile(CFG["india_locations"], re.I)
REMOTE_RX = re.compile(r"remote|anywhere|worldwide|work from home|\bwfh\b|distributed", re.I)
SKILL_RX = [(name, re.compile(p, re.I)) for name, p in [
    ("python", r"python|django|fastapi|\bflask\b"), ("java", r"\bjava\b|\bspring\b"), ("javascript", r"javascript|\bjs\b"),
    ("typescript", r"typescript"), ("react", r"\breact\b"), ("node", r"\bnode(\.?js)?\b"), ("go", r"\bgolang\b|\bgo developer|\bgo engineer"),
    ("rust", r"\brust\b"), ("kotlin", r"kotlin"), ("swift", r"\bswift(ui)?\b"), ("flutter", r"flutter|\bdart\b"),
    ("android", r"android"), ("ios", r"\bios\b"), ("c++", r"c\+\+"), ("c#/.net", r"c#|\.net\b"),
    ("php", r"\bphp\b|laravel"), ("ruby", r"\bruby\b|\brails\b"), ("aws", r"\baws\b"), ("azure", r"azure"),
    ("gcp", r"\bgcp\b|google cloud"), ("kubernetes", r"kubernetes|\bk8s\b"), ("devops", r"devops|\bsre\b"),
    ("data", r"\bdata\b|\bsql\b|spark|etl|analytics"), ("ml/ai", r"machine learning|\bml\b|\bai\b|\bllm|deep learning"),
    ("security", r"security"), ("frontend", r"front.?end"), ("backend", r"back.?end"), ("full stack", r"full.?stack"),
    ("mobile", r"\bmobile\b"), ("qa", r"\bqa\b|\btest(ing|er)?\b|\bsdet\b"),
]]


class Skip(Exception):
    """Source deliberately not run (e.g. missing API key)."""


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- helpers

def http_get(url, headers=None, tries=3):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"}
    if headers:
        h.update(headers)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404, 410, 422):
                break
        except Exception as e:  # timeouts, resets, DNS
            last = e
        time.sleep(2 * (attempt + 1))
    raise last


def get_json(url, headers=None):
    return json.loads(http_get(url, headers).decode("utf-8", "replace"))


def parse_date(s):
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / 1000 if s > 1e12 else s, timezone.utc)
    s = str(s).strip()
    if s.isdigit():
        return parse_date(int(s))
    d = None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        pass
    if d is None:
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
            try:
                d = datetime.fromisoformat(m.group(1)) if m else None
            except ValueError:  # e.g. 2026-02-30
                d = None
            if d is None:
                return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    d = d.astimezone(timezone.utc)
    return min(d, NOW)


def parse_future_date(s):
    """Like parse_date but allows future dates (events, deadlines)."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ") if d else None


TAG_RE = re.compile(r"<[^>]+>")


def clean(s, limit=300):
    if not s:
        return ""
    s = html.unescape(TAG_RE.sub(" ", html.unescape(str(s))))
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[:limit].rsplit(" ", 1)[0] + "…"


def safe_url(u):
    u = (u or "").strip()
    return u if u.startswith(("https://", "http://")) else ""


def norm_url(u):
    try:
        p = urllib.parse.urlsplit(u.strip())
        q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query)
             if not k.lower().startswith(("utm_", "fbclid", "gclid", "ref_src"))]
        host = p.netloc.lower().removeprefix("www.")
        return urllib.parse.urlunsplit(("https", host, p.path.rstrip("/"), urllib.parse.urlencode(q), ""))
    except ValueError:
        return u


def make_id(*parts):
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:14]


def title_key(t):
    return " ".join(re.findall(r"[a-z0-9]+", t.lower())[:12])


def as_list(v):
    if not v:
        return []
    if isinstance(v, str):
        return [v]
    return [x.get("name", "") if isinstance(x, dict) else str(x) for x in v]


def classify(text, default=None):
    tags = [cid for cid, r in CAT_RX if r and r.search(text)]
    if default:
        if default in tags:
            tags.remove(default)
        tags.insert(0, default)
    return tags


# ---------------------------------------------------------------- feed parsing

XML_ENTITIES = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)(\w+);")
BARE_AMP = re.compile(r"&(?!(?:\w+|#\d+|#x[0-9a-fA-F]+);)")


def local(tag):
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def child_text(el, *names):
    for name in names:
        for c in el:
            if local(c.tag) == name:
                text = "".join(c.itertext()).strip()
                if text:
                    return text
    return ""


def parse_feed(data):
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        # Many feeds use HTML entities (&nbsp; etc.) that XML does not define.
        text = data.decode("utf-8", "replace").lstrip("﻿ \r\n\t")
        text = XML_ENTITIES.sub(lambda m: html.unescape(m.group(0)).replace("&", "&amp;"), text)
        text = BARE_AMP.sub("&amp;", text)
        root = ET.fromstring(text.encode("utf-8"))
    items = []
    for el in root.iter():
        if local(el.tag) not in ("item", "entry"):
            continue
        link = ""
        for c in el:
            if local(c.tag) != "link":
                continue
            href = c.get("href")
            if href and c.get("rel", "alternate") == "alternate":
                link = href
                break
            if not href and (c.text or "").strip():
                link = c.text.strip()
                break
        if not link:
            guid = child_text(el, "guid", "id")
            link = guid if guid.startswith("http") else ""
        items.append({
            "title": child_text(el, "title"),
            "url": link,
            "summary": child_text(el, "description", "summary", "encoded", "content"),
            "date": parse_date(child_text(el, "pubdate", "published", "updated", "date", "issued")),
            "region": child_text(el, "region"),
        })
    return items


# ---------------------------------------------------------------- item builders

def news_item(src, title, url, summary="", date=None, extra=None):
    title, url = clean(title, 220), safe_url(url)
    if not title or not url:
        return None
    summary = clean(summary)
    it = {"id": make_id(norm_url(url)), "title": title, "url": url, "summary": summary,
          "source": src["name"], "sid": src["id"], "weight": src.get("weight", 1),
          "date": iso(date), "seen": iso(NOW), "tags": classify(f"{title} {summary}", src.get("category"))}
    if extra:
        it.update(extra)
    return it


def job_item(src, title, company, location, url, date=None, tags=None, salary="", remote=None, text=""):
    title, url = clean(title, 160), safe_url(url)
    if not title or not url or not JOB_TITLE_RX.search(title):
        return None
    location = clean(location, 140)
    india = bool(INDIA_RX.search(location))
    is_remote = bool(remote) or bool(REMOTE_RX.search(location))
    regions = (["india"] if india else []) + (["remote"] if is_remote else [])
    if not regions:
        regions = ["global"]
    blob = f"{title} {' '.join(as_list(tags))} {clean(text, 2000)}"
    skills = [name for name, r in SKILL_RX if r.search(blob)]
    return {"id": make_id(norm_url(url)), "title": title, "company": clean(company, 80), "location": location,
            "url": url, "date": iso(date), "seen": iso(NOW), "regions": regions, "skills": skills[:8],
            "salary": clean(salary, 60), "source": src["name"], "sid": src["id"]}


def opp_item(src, kind, title, url, start=None, end=None, location="", online=None, summary="", extra=None, date=None):
    title, url = clean(title, 200), safe_url(url)
    if not title or not url:
        return None
    it = {"id": make_id(kind, norm_url(url)), "kind": kind, "title": title, "url": url,
          "source": src["name"], "sid": src["id"], "start": iso(start), "end": iso(end),
          "location": clean(location, 120), "online": online, "summary": clean(summary),
          "date": iso(date), "seen": iso(NOW)}
    if extra:
        it.update(extra)
    return it


def gh_headers():
    h = {"Accept": "application/vnd.github+json"}
    if ENV("GITHUB_TOKEN"):
        h["Authorization"] = f"Bearer {ENV('GITHUB_TOKEN')}"
    return h


class Results(list):
    """Items from a multi-part source plus the parts (companies, pages…) that failed."""
    failed = ()


def fan_out(fn, args, workers=8):
    """Run fn over args in parallel; one failing element does not sink the source.

    Items are tagged with their part so merge() can keep the previous items of a part that failed.
    """
    failed = []

    def safe(a):
        try:
            return [dict(x, part=str(a)) for x in fn(a) if x]
        except Exception as e:
            log(f"    ! {a}: {type(e).__name__}: {e}")
            failed.append(str(a))
            return []
    with ThreadPoolExecutor(workers) as ex:
        out = Results(x for lst in ex.map(safe, args) for x in lst)
    out.failed = tuple(failed)
    return out


# ---------------------------------------------------------------- news adapters

def a_rss(src):
    items = parse_feed(http_get(src["url"]))[: src.get("max_items", 30)]
    if src.get("kind"):  # an RSS feed listed under opportunities
        return [opp_item(src, src["kind"], i["title"], i["url"], summary=i["summary"], date=i["date"]) for i in items]
    return [news_item(src, i["title"], i["url"], i["summary"], i["date"]) for i in items]


def hn_item(src, h):
    discuss = f"https://news.ycombinator.com/item?id={h['objectID']}"
    return news_item(src, h.get("title"), h.get("url") or discuss, h.get("story_text") or "",
                     parse_date(h.get("created_at_i")),
                     {"points": h.get("points") or 0, "comments": h.get("num_comments") or 0, "discuss": discuss})


def a_hn_front(src):
    return [hn_item(src, h) for h in get_json(src["url"])["hits"]]


def a_hn_hot(src):
    since = int((NOW - timedelta(days=2)).timestamp())
    q = urllib.parse.urlencode({"tags": "story", "hitsPerPage": 80,
                                "numericFilters": f"points>{src.get('min_points', 100)},created_at_i>{since}"})
    return [hn_item(src, h) for h in get_json(f"{src['url']}?{q}")["hits"]]


def a_hf_papers(src):
    out = []
    for p in get_json(src["url"])[:30]:
        paper = p.get("paper") or p
        out.append(news_item(src, paper.get("title"), f"https://huggingface.co/papers/{paper.get('id')}",
                             paper.get("ai_summary") or paper.get("summary") or "",
                             parse_date(p.get("publishedAt") or paper.get("publishedAt")),
                             {"points": paper.get("upvotes") or 0}))
    return out


def a_github_releases(src):
    def one(repo):
        name = repo.split("/")[1]
        out = []
        for i in parse_feed(http_get(f"https://github.com/{repo}/releases.atom"))[: src.get("per_repo", 2)]:
            title = i["title"] if name.lower() in i["title"].lower() else f"{name} {i['title']}"
            out.append(news_item(src, title, i["url"], i["summary"], i["date"], {"release": True}))
        return out
    return fan_out(one, src["repos"])


def a_github_new_repos(src):
    since = (NOW - timedelta(days=src.get("days", 7))).strftime("%Y-%m-%d")
    q = urllib.parse.urlencode({"q": f"created:>{since}", "sort": "stars", "order": "desc",
                                "per_page": src.get("count", 25)})
    data = get_json(f"https://api.github.com/search/repositories?{q}", gh_headers())
    return [news_item(src, f"{r['full_name']} ★ {r['stargazers_count']:,}", r["html_url"], r.get("description") or "",
                      parse_date(r.get("created_at")), {"points": r["stargazers_count"], "lang": r.get("language")})
            for r in data.get("items", [])]


def a_cisa_kev(src):
    vulns = sorted(get_json(src["url"])["vulnerabilities"], key=lambda v: v.get("dateAdded", ""), reverse=True)
    return [news_item(src, f"{v['cveID']} actively exploited: {v.get('vendorProject', '')} {v.get('product', '')}"
                           f" — {v.get('vulnerabilityName', '')}",
                      f"https://nvd.nist.gov/vuln/detail/{v['cveID']}", v.get("shortDescription", ""),
                      parse_date(v.get("dateAdded")))
            for v in vulns[:25]]


# ---------------------------------------------------------------- job adapters

def a_remotive(src):
    return [job_item(src, j.get("title"), j.get("company_name"), j.get("candidate_required_location") or "Remote",
                     j.get("url"), parse_date(j.get("publication_date")), j.get("tags"), j.get("salary") or "", True)
            for j in get_json(src["url"]).get("jobs", [])]


def a_arbeitnow(src):
    out, url = [], src["url"]
    for _ in range(src.get("pages", 2)):
        d = get_json(url)
        out += [job_item(src, j.get("title"), j.get("company_name"), j.get("location") or "", j.get("url"),
                         parse_date(j.get("created_at")), j.get("tags"), "", j.get("remote") or None)
                for j in d.get("data", [])]
        url = (d.get("links") or {}).get("next")
        if not url:
            break
    return out


def a_remoteok(src):
    out = []
    for j in get_json(src["url"]):
        if not isinstance(j, dict) or not j.get("position"):
            continue
        lo, hi = j.get("salary_min"), j.get("salary_max")
        salary = f"${lo:,}–${hi:,}" if isinstance(lo, int) and isinstance(hi, int) and lo and hi else ""
        out.append(job_item(src, j["position"], j.get("company"), j.get("location") or "Remote",
                            j.get("url") or j.get("apply_url"), parse_date(j.get("date") or j.get("epoch")),
                            j.get("tags"), salary, True))
    return out


def a_himalayas(src):
    out = []
    for j in get_json(src["url"]).get("jobs", []):
        loc = ", ".join(as_list(j.get("locationRestrictions"))) or "Worldwide"
        out.append(job_item(src, j.get("title"), j.get("companyName"), loc, j.get("applicationLink") or j.get("guid"),
                            parse_date(j.get("pubDate")), j.get("categories"), "", True))
    return out


def a_jobicy(src):
    return [job_item(src, j.get("jobTitle"), j.get("companyName"), j.get("jobGeo") or "Remote", j.get("url"),
                     parse_date(j.get("pubDate")), as_list(j.get("jobIndustry")), "", True)
            for j in get_json(src["url"]).get("jobs", [])]


def a_rss_jobs(src):
    out = []
    for i in parse_feed(http_get(src["url"]))[:150]:
        company, _, title = i["title"].partition(": ")
        if not title:
            company, title = "", i["title"]
        out.append(job_item(src, title, company, i["region"] or ("Remote" if src.get("remote") else ""), i["url"],
                            i["date"], None, "", src.get("remote"), i["summary"]))
    return out


def a_hn_hiring(src):
    stories = get_json("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10")
    story = next((s for s in stories["hits"] if "who is hiring" in (s.get("title") or "").lower()), None)
    if not story:
        return []
    sid, out = str(story["objectID"]), []
    for page in range(10):
        d = get_json(f"https://hn.algolia.com/api/v1/search?tags=comment,story_{sid}&hitsPerPage=500&page={page}")
        for c in d.get("hits", []):
            if str(c.get("parent_id")) != sid:
                continue  # replies, not postings
            text = c.get("comment_text") or ""
            first = clean(re.split(r"<p>|\n", text, maxsplit=1)[0], 300)
            parts = [p.strip() for p in first.split("|") if p.strip()]
            if len(parts) < 2:
                continue
            role = next((p for p in parts[1:] if JOB_TITLE_RX.search(p)), parts[1])
            out.append(job_item(src, role, parts[0], " | ".join(parts[1:]),
                                f"https://news.ycombinator.com/item?id={c['objectID']}",
                                parse_date(c.get("created_at_i")), None, "", None, text))
        if page + 1 >= d.get("nbPages", 0):
            break
    return out


def a_adzuna(src):
    app_id, key = ENV("ADZUNA_APP_ID"), ENV("ADZUNA_APP_KEY")
    if not (app_id and key):
        raise Skip("add ADZUNA_APP_ID and ADZUNA_APP_KEY repo secrets to enable")

    def one(arg):
        cc, page = arg
        q = urllib.parse.urlencode({"app_id": app_id, "app_key": key, "results_per_page": 50,
                                    "what_or": src["what"], "max_days_old": 14, "sort_by": "date"})
        out = []
        for j in get_json(f"https://api.adzuna.com/v1/api/jobs/{cc}/search/{page}?{q}").get("results", []):
            lo, hi = j.get("salary_min"), j.get("salary_max")
            salary = f"{int(lo):,}–{int(hi):,}" if lo and hi else ""
            loc = (j.get("location") or {}).get("display_name", "")
            if cc == "in" and not INDIA_RX.search(loc):
                loc = f"{loc}, India".strip(", ")
            out.append(job_item(src, j.get("title"), (j.get("company") or {}).get("display_name"), loc,
                                j.get("redirect_url"), parse_date(j.get("created")), None, salary, None,
                                j.get("description", "")))
        return out
    return fan_out(one, [(cc, p) for cc in src["countries"] for p in range(1, src.get("pages", 1) + 1)], 4)


def company_board(src, fetch):
    def one(entry):
        slug, _, name = entry.partition(":")
        jobs = [j for j in fetch(slug, name or slug.title()) if j]
        jobs.sort(key=lambda j: j["date"] or "", reverse=True)
        return jobs[: src.get("per_company", 120)]
    return fan_out(one, src["companies"])


def a_greenhouse(src):
    def fetch(slug, name):
        d = get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
        return [job_item(src, j.get("title"), j.get("company_name") or name, (j.get("location") or {}).get("name", ""),
                         j.get("absolute_url"), parse_date(j.get("first_published") or j.get("updated_at")))
                for j in d.get("jobs", [])]
    return company_board(src, fetch)


def a_lever(src):
    def fetch(slug, name):
        return [job_item(src, j.get("text"), name, (j.get("categories") or {}).get("location", ""), j.get("hostedUrl"),
                         parse_date(j.get("createdAt")), [(j.get("categories") or {}).get("team", "")], "",
                         j.get("workplaceType") == "remote" or None)
                for j in get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")]
    return company_board(src, fetch)


def a_ashby(src):
    def fetch(slug, name):
        d = get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        return [job_item(src, j.get("title"), name, j.get("location") or "", j.get("jobUrl"),
                         parse_date(j.get("publishedAt")), [j.get("department") or ""], "",
                         j.get("isRemote") or j.get("workplaceType") == "Remote" or None)
                for j in d.get("jobs", [])]
    return company_board(src, fetch)


# ---------------------------------------------------------------- opportunity adapters

def parse_devpost_dates(s):
    m = re.match(r"\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?\s*-\s*(?:([A-Za-z]{3})[a-z]*\s+)?(\d{1,2}),\s*(\d{4})",
                 s or "")
    if not m:
        return None, None
    m1, d1, y1, m2, d2, y2 = m.groups()
    try:
        start = datetime.strptime(f"{m1} {d1} {y1 or y2}", "%b %d %Y").replace(tzinfo=timezone.utc)
        end = datetime.strptime(f"{m2 or m1} {d2} {y2}", "%b %d %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None, None
    if start > end and not y1:
        start = start.replace(year=start.year - 1)
    return start, end + timedelta(hours=23, minutes=59)


def a_devpost(src):
    def one(page):
        out = []
        for h in get_json(f"{src['url']}&page={page}").get("hackathons", []):
            start, end = parse_devpost_dates(h.get("submission_period_dates", ""))
            loc = (h.get("displayed_location") or {}).get("location", "")
            out.append(opp_item(src, "hackathon", h.get("title"), h.get("url"), start, end, loc,
                                loc.strip().lower() == "online", ", ".join(as_list(h.get("themes"))),
                                {"prize": clean(h.get("prize_amount", ""), 40),
                                 "deadline_text": clean(h.get("time_left_to_submission", ""), 60),
                                 "org": clean(h.get("organization_name", ""), 80)}))
        return out
    return fan_out(one, range(1, src.get("pages", 1) + 1), 3)


def a_confs_tech(src):
    def one(arg):
        year, topic = arg
        url = f"https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/{year}/{topic}.json"
        try:
            confs = get_json(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return []
            raise
        out = []
        for c in confs:
            start = parse_future_date(c.get("startDate"))
            end = parse_future_date(c.get("endDate")) or start
            if not end or end + timedelta(days=1) < NOW:
                continue
            country = c.get("country") or ""
            online = bool(c.get("online")) or country.lower() == "online"
            loc = ", ".join(x for x in (c.get("city"), country) if x) or ("Online" if online else "")
            out.append(opp_item(src, "conference", c.get("name"), c.get("url"), start, end, loc, online, "",
                                {"topic": topic}))
            cfp_end = parse_future_date(c.get("cfpEndDate"))
            if c.get("cfpUrl") and cfp_end and cfp_end > NOW:
                out.append(opp_item(src, "cfp", f"Call for speakers: {c.get('name')}", c.get("cfpUrl"), None, cfp_end,
                                    loc, online, "", {"topic": topic}))
        return out
    return fan_out(one, [(y, t) for y in (NOW.year, NOW.year + 1) for t in src["topics"]])


def a_github_good_first(src):
    since = (NOW - timedelta(days=14)).strftime("%Y-%m-%d")

    def one(lang):
        q = urllib.parse.urlencode({
            "q": f'label:"good first issue" is:issue is:open no:assignee language:{lang} created:>{since}',
            "sort": "created", "order": "desc", "per_page": src.get("per_language", 8)})
        data = get_json(f"https://api.github.com/search/issues?{q}", gh_headers())
        out = []
        for i in data.get("items", []):
            repo = i.get("repository_url", "").removeprefix("https://api.github.com/repos/")
            out.append(opp_item(src, "open-source", f"[{repo}] {i.get('title')}", i.get("html_url"),
                                summary=i.get("body") or "", date=parse_date(i.get("created_at")),
                                extra={"lang": lang}))
        return out
    return fan_out(one, src["languages"], 2)


# ---------------------------------------------------------------- learn: Q&A and interview prep
#
# Answers are stored as simple blocks ({"t": "p"|"li"|"h"|"code"|"more", "x": text}) so the app can
# render them as plain text — no feed HTML is ever injected into the page.

LEARN_TOPICS = {t["id"]: t for t in CFG.get("learn_topics", [])}
SE_API = "https://api.stackexchange.com/2.3"
SCENARIO_RX = re.compile(
    r"\bhow (would|do|can|should|to)\b|\bdesign (a|an)\b|what happens (when|if)|\bbest (way|practice)|"
    r"\bwhen (should|to use)\b|\bhandle\b|optimi[sz]|\bscal(e|ing|able)\b|troubleshoot|\bdebug|\bmigrat|"
    r"\bprevent\b|\bavoid\b|\bimprove\b|\bslow\b|\bsecure\b|scenario|\bsuppose\b|\bimagine\b|\breal[- ]world", re.I)
QUESTION_RX = re.compile(
    r"\?\s*$|^(what|how|why|when|which|where|who|explain|describe|define|difference|differentiate|compare|can|is|are|"
    r"does|do|should|name|list|write|give|tell)\b", re.I)
SKIP_HEAD_RX = re.compile(r"table of contents|disclaimer|contribut|licen[sc]e|back to top|sponsor|^\W*$", re.I)
HEAD_RX = re.compile(r"^\s{0,4}(?:\d+\.\s*)?(#{2,4})\s+(.+?)(?:\s+#+)?\s*$")
HTML_TAG_RX = re.compile(
    r"</?(?:a|b|i|u|s|em|strong|br|p|div|span|img|sup|sub|code|pre|details|summary|kbd|ul|ol|li|table|thead|tbody|"
    r"tr|td|th|h[1-6]|hr|center|font|del|ins|blockquote|picture|source|video)\b[^<>]*>", re.I)


def text_of(fragment, limit=None):
    """Plain text from escaped HTML (Stack Overflow). Strips tags first so `List&lt;T&gt;` survives."""
    s = html.unescape(TAG_RE.sub(" ", fragment or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit].rsplit(" ", 1)[0] + "…" if limit and len(s) > limit else s


def html_blocks(body, limit=3000):
    blocks, total = [], 0
    for m in re.finditer(r"<pre[^>]*>(.*?)</pre>|<(p|li|h[1-6]|blockquote)\b[^>]*>(.*?)</\2>", body or "", re.S | re.I):
        if m.group(1) is not None:
            text = html.unescape(TAG_RE.sub("", m.group(1))).strip("\n")
            block = {"t": "code", "x": text[:1500]}
        else:
            inner = re.sub(r"<code>(.*?)</code>", r"`\1`", m.group(3), flags=re.S)
            text = text_of(inner, 1200)
            kind = m.group(2).lower()
            block = {"t": "li" if kind == "li" else "h" if kind.startswith("h") else "p", "x": text}
        if not block["x"]:
            continue
        blocks.append(block)
        total += len(block["x"])
        if total > limit:
            blocks.append({"t": "more"})
            break
    return blocks


def md_inline(s):
    # Only touch prose: `__eq__`, `**kwargs` or `<div>` inside backticks must survive untouched.
    parts = re.split(r"(`[^`]*`)", s)
    for n in range(0, len(parts), 2):
        p = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", parts[n])
        p = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", p)
        p = re.sub(r"\*\*(.+?)\*\*", r"\1", p)
        p = re.sub(r"(?<!\w)__(.+?)__(?!\w)", r"\1", p)
        parts[n] = html.unescape(HTML_TAG_RX.sub(" ", p))
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def md_blocks(md, limit=3000):
    blocks, para = [], []
    lines = textwrap.dedent(md).split("\n")

    def flush():
        if para:
            text = md_inline(" ".join(para))
            para.clear()
            if text:
                blocks.append({"t": "p", "x": text})

    i = 0
    while i < len(lines) and sum(len(b["x"]) for b in blocks) < limit:
        s = lines[i].strip()
        if s.startswith(("```", "~~~")):
            flush()
            fence, code = s[:3], []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(fence):
                code.append(lines[i])
                i += 1
            text = textwrap.dedent("\n".join(code)).strip("\n")
            if text:
                blocks.append({"t": "code", "x": text[:1500]})
        elif s.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = lines[i].strip()
                if not re.fullmatch(r"\|?[\s:|-]+\|?", row):
                    rows.append(md_inline(row))
                i += 1
            if rows:
                blocks.append({"t": "code", "x": "\n".join(rows)[:1500]})
            continue
        elif re.match(r"([-*+]|\d+[.)])\s+", s):
            flush()
            text = md_inline(re.sub(r"^([-*+]|\d+[.)])\s+", "", s))
            if text:
                blocks.append({"t": "li", "x": text})
        elif re.match(r"#{1,6}\s", s):
            flush()
            text = md_inline(s.lstrip("#").strip())
            if text:
                blocks.append({"t": "h", "x": text})
        elif not s or s.startswith("<!--") or re.fullmatch(r"[-*_]{3,}", s) or "back to top" in s.lower():
            flush()
        else:
            para.append(s)
        i += 1
    flush()
    if any(line.strip() for line in lines[i:]):
        blocks.append({"t": "more"})
    return blocks


def gh_anchor(heading):
    return re.sub(r"[^\w\- ]", "", md_inline(heading).lower()).replace(" ", "-")


def md_questions(md):
    """Split a Q&A markdown file into (question, raw heading, answer markdown)."""
    sections, cur, buf = [], None, []
    for line in md.split("\n"):
        m = HEAD_RX.match(line)
        if m:
            heading = m.group(2)
            if cur is not None and re.match(r"(answers?|solution)\b", md_inline(heading), re.I):
                continue  # "### Answer" belongs to the question above
            if cur is not None:
                sections.append((cur, buf))
            cur, buf = heading, []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        sections.append((cur, buf))
    out = []
    for heading, lines in sections:
        title = md_inline(heading)
        title = re.sub(r"^(question\s*\d+[.:]?|q\d+[.:]?|\d+[.)])\s*", "", title, flags=re.I).strip()
        body = "\n".join(lines)
        if SKIP_HEAD_RX.search(title) or not QUESTION_RX.search(title):
            continue
        if 8 <= len(title) <= 220 and len(body.strip()) >= 40:
            out.append((title, heading, body))
    return out


def learn_item(src, topic, mode, title, url, answer, **kw):
    url = safe_url(url)
    if not title or not url or not answer:
        return None
    scenario = kw.pop("scenario", None)
    it = {"id": make_id(topic, mode, url, title), "topic": topic, "mode": mode, "title": title, "url": url,
          "answer": answer, "scenario": bool(SCENARIO_RX.search(title)) if scenario is None else scenario,
          "source": src["name"], "sid": src["id"], "date": None, "seen": iso(NOW)}
    it.update({k: v for k, v in kw.items() if v not in (None, "", [])})
    return it


def se_get(path, **params):
    params.setdefault("site", "stackoverflow")
    if ENV("STACKEXCHANGE_KEY"):
        params["key"] = ENV("STACKEXCHANGE_KEY")
    d = get_json(f"{SE_API}{path}?{urllib.parse.urlencode(params)}")
    if d.get("error_id"):
        raise RuntimeError(f"Stack Exchange {d.get('error_name')}: {d.get('error_message')}")
    time.sleep(0.2 + d.get("backoff", 0))  # the API requires honouring backoff
    return d


def a_stackoverflow(src):
    """Top-voted and recent questions per topic — only those with an accepted answer."""
    out, failed = Results(), []
    for tid, topic in LEARN_TOPICS.items():
        tags = topic.get("so_tags") or []
        if not tags:
            continue
        try:
            calls = [(w["mode"], w.get("days"), tags[0], w["count"]) for w in src["windows"]]
            calls += [("qa", None, t, src.get("secondary_count", 10)) for t in tags[1:]]
            qs = {}
            for mode, days, tag, count in calls:
                params = {"order": "desc", "sort": "votes", "tagged": tag, "pagesize": count, "filter": "withbody"}
                if days:
                    params["fromdate"] = int((NOW - timedelta(days=days)).timestamp())
                for q in se_get("/questions", **params).get("items", []):
                    if q.get("accepted_answer_id") and q["question_id"] not in qs:
                        qs[q["question_id"]] = (mode, q)
            ids = [q["accepted_answer_id"] for _, q in qs.values()]
            answers = {}
            for k in range(0, len(ids), 100):
                batch = ";".join(str(x) for x in ids[k:k + 100])
                for a in se_get(f"/answers/{batch}", filter="withbody", pagesize=100).get("items", []):
                    answers[a["answer_id"]] = a
            for mode, q in qs.values():
                a = answers.get(q["accepted_answer_id"])
                if not a:
                    continue
                it = learn_item(src, tid, mode, text_of(q.get("title"), 220), q.get("link"),
                                html_blocks(a.get("body", ""), 3000),
                                question=html_blocks(q.get("body", ""), 700), score=q.get("score"),
                                answer_score=a.get("score"), accepted=True,
                                author=text_of((a.get("owner") or {}).get("display_name")),
                                answer_url=f"https://stackoverflow.com/a/{a['answer_id']}",
                                license="CC BY-SA 4.0", date=iso(parse_date(q.get("creation_date"))),
                                views=q.get("view_count"))
                if it:
                    it["part"] = tid
                    out.append(it)
        except Exception as e:
            log(f"    ! {tid}: {type(e).__name__}: {e}")
            failed.append(tid)
    out.failed = tuple(failed)
    return out


def repo_info(repo, allow_spdx=None):
    info = get_json(f"https://api.github.com/repos/{repo}", gh_headers())
    spdx = (info.get("license") or {}).get("spdx_id") or "NONE"
    if allow_spdx and spdx not in allow_spdx:
        raise RuntimeError(f"license is {spdx}, expected {'/'.join(allow_spdx)} — skipped to respect copyright")
    return info, spdx


def a_github_markdown(src):
    info, spdx = repo_info(src["repo"], src.get("allow_spdx"))
    md = http_get(f"https://raw.githubusercontent.com/{src['repo']}/{info['default_branch']}/"
                  f"{src.get('path', 'README.md')}").decode("utf-8", "replace")
    out = [learn_item(src, src["topic"], "interview", title, f"https://github.com/{src['repo']}#{gh_anchor(heading)}",
                      md_blocks(body, 2500), license=src.get("license") or spdx,
                      author=src["repo"].split("/")[0], stars=info.get("stargazers_count"))
           for title, heading, body in md_questions(md)]
    return out[: src.get("max_items", 400)]


def a_sdp_solutions(src):
    repo, path = src["repo"], src["path"]
    info, _ = repo_info(repo)
    raw = f"https://raw.githubusercontent.com/{repo}/{info['default_branch']}"
    if src.get("license_text") and src["license_text"] not in http_get(f"{raw}/README.md").decode("utf-8", "replace"):
        raise RuntimeError("license notice not found in README — skipped to respect copyright")
    dirs = [d["name"] for d in get_json(f"https://api.github.com/repos/{repo}/contents/{path}", gh_headers())
            if d.get("type") == "dir"]

    def one(d):
        md = http_get(f"{raw}/{path}/{d}/README.md").decode("utf-8", "replace")
        m = re.search(r"^#\s+(.+)$", md, re.M)
        title = md_inline(m.group(1)) if m else d.replace("_", " ").title()
        return [learn_item(src, src["topic"], "interview", title,
                           f"https://github.com/{repo}/tree/{info['default_branch']}/{path}/{d}",
                           md_blocks(md[m.end():] if m else md, 3500), scenario=True, level="advanced",
                           license=src.get("license"), author=repo.split("/")[0], stars=info.get("stargazers_count"))]
    return fan_out(one, dirs, 4)


def a_curated(src):
    """interview/<topic>.md — '### Question' then an optional <!-- level: …; kind: …; ref: … --> line, then the answer."""
    folder = os.path.join(ROOT, src.get("path", "interview"))

    def one(fname):
        topic = os.path.splitext(fname)[0]
        if topic not in LEARN_TOPICS:
            raise ValueError(f"'{topic}' is not a learn_topics id")
        with open(os.path.join(folder, fname), encoding="utf-8") as f:
            text = f.read()
        out = []
        for chunk in re.split(r"^###\s+", text, flags=re.M)[1:]:
            heading, _, body = chunk.partition("\n")
            meta = {}
            m = re.search(r"<!--(.*?)-->", body, re.S)
            if m:
                for part in m.group(1).split(";"):
                    k, _, v = part.partition(":")
                    meta[k.strip().lower()] = v.strip()
                body = body[:m.start()] + body[m.end():]
            ref = meta.get("ref") or ""
            out.append(learn_item(src, topic, "interview", md_inline(heading), ref, md_blocks(body, 5000),
                                  scenario=meta.get("kind") == "scenario", level=meta.get("level"), ref=ref,
                                  author="TechPulse", license="Reviewed against official docs"))
        return out
    return fan_out(one, sorted(f for f in os.listdir(folder) if f.endswith(".md")), 4)


ADAPTERS = {
    "rss": a_rss, "hn_front": a_hn_front, "hn_hot": a_hn_hot, "hf_papers": a_hf_papers,
    "github_releases": a_github_releases, "github_new_repos": a_github_new_repos, "cisa_kev": a_cisa_kev,
    "remotive": a_remotive, "arbeitnow": a_arbeitnow, "remoteok": a_remoteok, "himalayas": a_himalayas,
    "jobicy": a_jobicy, "rss_jobs": a_rss_jobs, "hn_hiring": a_hn_hiring, "adzuna": a_adzuna,
    "greenhouse": a_greenhouse, "lever": a_lever, "ashby": a_ashby,
    "devpost": a_devpost, "confs_tech": a_confs_tech, "github_good_first": a_github_good_first,
    "stackoverflow": a_stackoverflow, "github_markdown": a_github_markdown, "sdp_solutions": a_sdp_solutions,
    "curated": a_curated,
}
GROUPS = ("news", "jobs", "opportunities", "learn")


# ---------------------------------------------------------------- running & merging

def is_due(src, prev_health):
    if ENV("FORCE_ALL") == "1":
        return True
    h = prev_health.get(src["id"])
    last = parse_future_date(h.get("last_run")) if h else None
    if not last or not h.get("ok"):
        return True  # never ran, or failed last time: retry every run
    return NOW - last >= timedelta(minutes=src.get("every", 30) - 3)


def run_group(group, prev_health):
    def go(src):
        t = time.time()
        try:
            adapter = ADAPTERS.get(src["type"])
            if not adapter:
                raise ValueError(f"unknown source type '{src['type']}'")
            raw = adapter(src)
            failed = getattr(raw, "failed", ())
            items = [i for i in raw if i]
            if failed and not items:
                return src, None, f"all parts failed: {', '.join(failed[:5])}"[:240], (), time.time() - t
            return src, items, None, failed, time.time() - t
        except Skip as e:
            return src, None, f"disabled: {e}", (), time.time() - t
        except Exception as e:
            return src, None, f"{type(e).__name__}: {e}"[:240], (), time.time() - t

    due = [s for s in CFG.get(group, []) if is_due(s, prev_health)]
    results = {}
    with ThreadPoolExecutor(12) as ex:
        for src, items, err, failed, secs in ex.map(go, due):
            results[src["id"]] = (items, err, failed)
            note = f", {len(failed)} part(s) failed" if failed else ""
            log(f"  {'✗' if err else '✓'} {group}/{src['id']}: {err or f'{len(items)} items{note}'} ({secs:.1f}s)")
    return results


def update_health(prev_health, fresh):
    out = []
    for group in GROUPS:
        for src in CFG.get(group, []):
            sid = src["id"]
            h = dict(prev_health.get(sid) or {})
            h.update({"id": sid, "name": src["name"], "group": group, "type": src["type"], "every": src.get("every", 30)})
            if sid in fresh[group]:
                items, err, failed = fresh[group][sid]
                h["last_run"] = iso(NOW)
                if err:
                    h.update(ok=False, error=err, fails=h.get("fails", 0) + (0 if err.startswith("disabled") else 1),
                             disabled=err.startswith("disabled"))
                else:
                    h.update(ok=True, error=None, fails=0, count=len(items), last_ok=iso(NOW), disabled=False,
                             partial=f"{len(failed)} failed: {', '.join(failed[:5])}" if failed else None)
            out.append(h)
    return out


def item_time(it):
    return it.get("date") or it.get("seen") or ""


def merge(prev_items, fresh_group, replace_sources, keep_since, cap, dedupe_titles=False):
    """Combine previous and fresh items.

    replace_sources: fresh results replace that source's previous items entirely
    (jobs/opportunities, so closed postings disappear); otherwise items accumulate.
    """
    ok_sids = {sid for sid, (items, err, failed) in fresh_group.items() if not err}
    keep_parts = {(sid, p) for sid, (items, err, failed) in fresh_group.items() for p in failed}
    by_id, by_title = {}, {}
    for it in prev_items:
        if replace_sources and it.get("sid") in ok_sids and (it["sid"], it.get("part")) not in keep_parts:
            continue
        by_id[it["id"]] = it
        if dedupe_titles and title_key(it["title"]):
            by_title.setdefault(title_key(it["title"]), it["id"])
    prev_by_id = {it["id"]: it for it in prev_items}
    new = []
    for sid, (items, err, failed) in fresh_group.items():
        for it in items or []:
            if dedupe_titles and title_key(it["title"]):
                tid = by_title.get(title_key(it["title"]))
                if tid and tid != it["id"] and tid in by_id:
                    same = by_id[tid]  # same story from another outlet: credit it, keep one card
                    if it["source"] != same["source"] and it["source"] not in same.get("also", []):
                        same["also"] = (same.get("also") or []) + [it["source"]]
                    same["weight"] = max(same.get("weight", 1), it.get("weight", 1))
                    continue
            old = prev_by_id.get(it["id"]) or by_id.get(it["id"])
            if old:
                it["seen"] = old.get("seen") or it["seen"]
                it["date"] = it.get("date") or old.get("date")
                if old.get("alerted"):
                    it["alerted"] = True
                also = set(old.get("also") or []) | ({old["source"]} if old.get("source") else set())
                also.discard(it["source"])
                if also:
                    it["also"] = sorted(also)
            else:
                new.append(it)
            by_id[it["id"]] = it
            if dedupe_titles and title_key(it["title"]):
                by_title.setdefault(title_key(it["title"]), it["id"])
    cutoff = iso(keep_since)
    items = [i for i in by_id.values() if item_time(i) >= cutoff]
    items.sort(key=item_time, reverse=True)
    new_ids = {i["id"] for i in new}
    return items[:cap], [i for i in items[:cap] if i["id"] in new_ids]


def opportunities_from_news(news_items):
    out = []
    for it in news_items:
        text = f"{it['title']} {it.get('summary', '')}"
        for kind, r in OPP_RX:
            if r and r.search(text):
                o = opp_item({"name": it["source"], "id": "from-news"}, kind, it["title"], it["url"],
                             summary=it.get("summary", ""), date=parse_date(it.get("date")))
                if o:
                    out.append(o)
                break
    return out


# ---------------------------------------------------------------- trends

STOP = set("""a an the and or of to in on for with by from at as is are was were be been it its this that these
those how why what when who new now just your you we our they their his her not no vs via into over after before about
up out more most than can will may could should would has have had do does did get gets got make makes using use used
first top best big says said report reports update updates announces launches launch released release introduces
introducing week today year day show ask tell here there all one two three back off still also only way time
help world next amid could million billion""".split())
TOKEN_RX = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-]{1,30}")


def terms(title):
    words = [w.strip(".-").lower() for w in TOKEN_RX.findall(title)]
    words = [w for w in words if len(w) > 2 and w not in STOP]
    return set(words) | {f"{a} {b}" for a, b in zip(words, words[1:])}


def compute_trends(news):
    recent_cut = iso(NOW - timedelta(hours=24))
    recent, base = {}, {}
    for it in news:
        bucket = recent if item_time(it) >= recent_cut else base
        for g in terms(it["title"]):
            bucket.setdefault(g, []).append(it)
    base_days = max(1, NEWS_KEEP_DAYS - 1)
    scored = []
    for g, items in recent.items():
        sids = {i["sid"] for i in items}
        if len(sids) < 3:
            continue
        baseline = len(base.get(g, [])) / base_days
        score = len(sids) * len(items) / (1 + baseline) * (1.3 if " " in g else 1)
        scored.append((score, g, items, baseline))
    scored.sort(reverse=True, key=lambda x: x[0])
    picked, covered = [], []
    for score, g, items, baseline in scored:
        ids = {i["id"] for i in items}
        if any(len(ids & c) >= 0.7 * len(ids) for c in covered):
            continue  # mostly the same stories as a term already picked
        covered.append(ids)
        top = sorted(items, key=lambda i: (i.get("weight", 1), item_time(i)), reverse=True)
        picked.append({"term": g, "score": round(score, 1), "count": len(items), "sources": len({i["sid"] for i in items}),
                       "new": baseline == 0, "items": [i["id"] for i in top[:12]]})
        if len(picked) >= 25:
            break
    return picked


# ---------------------------------------------------------------- alerts

def ntfy(topic, title, message, click=None, tags=None):
    body = {"topic": topic, "title": title[:250], "message": message[:1000]}
    if click:
        body["click"] = click
    if tags:
        body["tags"] = tags
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "User-Agent": UA})
    urllib.request.urlopen(req, timeout=20).read()


def send_alerts(news, jobs, first_run):
    a = CFG.get("alerts", {})
    kw, jkw = rx(a.get("keywords")), rx(a.get("job_keywords"))
    fresh_cut = iso(NOW - timedelta(hours=36))
    picks = []
    for it in news:
        if it.get("alerted") or (it.get("seen") or "") < fresh_cut:
            continue
        important = (it.get("weight", 1) >= a.get("min_weight", 3) and kw and kw.search(it["title"])) \
            or it.get("points", 0) >= a.get("hn_points", 10 ** 9)
        if important:
            picks.append(("news", it))
    regions = set(a.get("job_regions") or [])
    for j in jobs:
        if jkw and not j.get("alerted") and (j.get("seen") or "") >= fresh_cut and jkw.search(j["title"]) \
                and (not regions or regions & set(j.get("regions") or [])):
            picks.append(("job", j))
    for _, it in picks:
        it["alerted"] = True
    topic = ENV("NTFY_TOPIC")
    if not topic or first_run or not picks:
        return
    limit = a.get("max_per_run", 5)
    try:
        for kind, it in picks[:limit]:
            if kind == "job":
                ntfy(topic, f"Job: {it['title']}", f"{it['company']} · {it['location']}", it["url"], ["briefcase"])
            else:
                ntfy(topic, it["title"], f"{it['source']} — {it.get('summary', '')}", it["url"], ["zap"])
        if len(picks) > limit:
            ntfy(topic, f"+{len(picks) - limit} more updates", "Open TechPulse to see everything new.", None, ["bell"])
        log(f"  sent {min(len(picks), limit)} alert(s)")
    except Exception as e:
        log(f"::warning::ntfy alert failed: {e}")


# ---------------------------------------------------------------- main

def load_prev(name):
    base = ENV("PREVIOUS_DATA_URL")
    if base:
        try:
            return json.loads(http_get(f"{base.rstrip('/')}/{name}?t={int(time.time())}"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None  # first deploy
            raise  # never publish over good data because the old copy could not be read
    path = os.path.join(OUT_DIR, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def write(name, data):
    with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def main():
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)
    prev = {n: load_prev(f"{n}.json") for n in ("news", "jobs", "opportunities", "health", "learn/_all")}
    first_run = prev["news"] is None
    prev_health = {h["id"]: h for h in (prev["health"] or {}).get("sources", [])}
    log(f"TechPulse fetch at {iso(NOW)} (first run: {first_run})")

    fresh = {}
    for group in GROUPS:
        log(f"[{group}]")
        fresh[group] = run_group(group, prev_health)

    news, new_news = merge((prev["news"] or {}).get("items", []), fresh["news"], False,
                           NOW - timedelta(days=NEWS_KEEP_DAYS), NEWS_MAX, dedupe_titles=True)
    jobs, _ = merge((prev["jobs"] or {}).get("items", []), fresh["jobs"], True,
                    NOW - timedelta(days=JOBS_KEEP_DAYS), JOBS_MAX)

    opp_fresh = dict(fresh["opportunities"])
    opp_fresh["from-news"] = (opportunities_from_news(new_news), None, ())
    # No age cut-off here: events are dropped once they end (below), not by when we first saw them.
    opps, _ = merge((prev["opportunities"] or {}).get("items", []), opp_fresh, True,
                    NOW - timedelta(days=3650), 3000)
    # The from-news bucket accumulates; the real sources are replaced each fetch.
    prev_from_news = [o for o in (prev["opportunities"] or {}).get("items", [])
                      if o.get("sid") == "from-news" and o["id"] not in {x["id"] for x in opps}
                      and item_time(o) >= iso(NOW - timedelta(days=FROM_NEWS_KEEP_DAYS))]
    opps += prev_from_news
    now_iso = iso(NOW - timedelta(days=1))
    opps = [o for o in opps if not o.get("end") or o["end"] >= now_iso]
    opps.sort(key=lambda o: o.get("end") or o.get("start") or "9999")

    # No age cut-off: classic top-voted questions were often asked 15+ years ago.
    learn, _ = merge((prev["learn/_all"] or {}).get("items", []), fresh["learn"], True,
                     NOW - timedelta(days=365 * 50), 30000)

    send_alerts(news, jobs, first_run)
    health = update_health(prev_health, fresh)
    trends = compute_trends(news)

    write("news.json", {"updated": iso(NOW), "items": news})
    write("jobs.json", {"updated": iso(NOW), "items": jobs})
    write("opportunities.json", {"updated": iso(NOW), "items": opps})
    write("trends.json", {"updated": iso(NOW), "terms": trends})
    write("health.json", {"updated": iso(NOW), "sources": health})

    # Learn data is split per topic so the app only downloads the language you open.
    os.makedirs(os.path.join(OUT_DIR, "learn"), exist_ok=True)
    by_topic = {}
    for it in learn:
        by_topic.setdefault(it["topic"], []).append(it)
    topics_out = []
    for tid, t in LEARN_TOPICS.items():
        items = by_topic.get(tid, [])
        write(f"learn/{tid}.json", {"updated": iso(NOW), "topic": tid, "items": items})
        topics_out.append({"id": tid, "label": t["label"], "group": t.get("group", ""), "counts": {
            "interview": sum(1 for i in items if i["mode"] == "interview"),
            "scenario": sum(1 for i in items if i.get("scenario")),
            "qa": sum(1 for i in items if i["mode"] == "qa"),
            "latest": sum(1 for i in items if i["mode"] == "latest")}})
    write("learn/index.json", {"updated": iso(NOW), "topics": topics_out})
    write("learn/_all.json", {"updated": iso(NOW), "items": learn})

    write("meta.json", {
        "updated": iso(NOW),
        "categories": [{"id": c["id"], "label": c["label"], "keywords": c["keywords"]} for c in CFG["categories"]],
        "counts": {"news": len(news), "jobs": len(jobs), "opportunities": len(opps), "trends": len(trends),
                   "learn": len(learn)},
        "sources": {"total": len(health), "ok": sum(1 for h in health if h.get("ok")),
                    "failing": [h["name"] for h in health if h.get("ok") is False and not h.get("disabled")]},
    })

    for h in health:
        if h.get("fails", 0) >= 3:
            log(f"::warning::Source '{h['name']}' has failed {h['fails']} runs in a row: {h.get('error')}")
    log(f"Done in {time.time() - t0:.0f}s — news {len(news)} (+{len(new_news)}), jobs {len(jobs)}, "
        f"opportunities {len(opps)}, trends {len(trends)}, learn {len(learn)}")


if __name__ == "__main__":
    sys.exit(main())

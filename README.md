# TechPulse

Latest tech, coding and AI updates, rising topics, jobs and opportunities. It runs as an
installable app on Android, iPhone and desktop. Hosting is free (GitHub Pages and GitHub Actions),
and nothing runs on your PC.

## How it works

```
sources.json (what to fetch)
      │  GitHub Actions runs fetcher/fetch.py every 15 min
      ▼
RSS feeds + public APIs ──► dedupe · categorize · trend detection · source health
      │
      ▼
site/data/*.json ──► GitHub Pages ──► app on your phone (cached for offline use)
      │
      └──► optional push alerts through the free ntfy app
```

- **News:** every 15–60 min, depending on the source (official AI labs, dev blogs, cloud
  providers, security, Indian tech media, Hacker News, arXiv, GitHub releases).
- **Rising:** topics that several sources started covering in the last 24 hours, compared with
  the days before.
- **Jobs:** every 4–6 h. Sources are company career pages (Greenhouse, Lever, Ashby), remote job
  boards, HN "Who is hiring" and, optionally, Adzuna. Each job is tagged India, Remote or Global.
- **Opportunities:** daily. Hackathons (Devpost), conferences and calls for speakers (confs.tech),
  GitHub good-first-issues, plus programs, fellowships and free learning picked up from the news.
- **Source health:** the Settings screen lists every source as live or failing. A source that
  breaks never stops the others.

## One-time setup (about 10 minutes, all in the browser)

1. **Create a free GitHub account** at https://github.com/signup if you don't have one.
2. **Create the repository.** Go to https://github.com/new, name it `techpulse`, choose
   **Public** (free hosting requires it), tick **Add a README file**, then click **Create repository**.
3. **Turn on hosting.** In the repo, open **Settings → Pages**. Under *Build and deployment*,
   set **Source** to **GitHub Actions**.
4. **Upload the files.** In the repo, click **Add file → Upload files**. Drag in everything
   inside this `TechPulse` folder, including the `.github` folder, and click **Commit changes**.
   Then check that `.github/workflows/update.yml` appears in the repo. If it doesn't, use
   **Add file → Create new file**, type `.github/workflows/update.yml` as the name, paste the
   file's contents and commit.
5. **Run the first update.** Open the **Actions** tab (click *Enable* if asked), select
   **Update TechPulse**, click **Run workflow**, tick *Fetch every source now*, and click **Run workflow**.
   It takes about 3–5 minutes. After that it runs automatically every 15 minutes.
6. **Open the app** at `https://<your-github-username>.github.io/techpulse/`.

## Install on your phone

**Android (Chrome)**
1. Open the app link in Chrome.
2. Tap **Install** at the top of the app, or menu **⋮ → Install app / Add to Home screen**.
3. TechPulse appears in your app drawer and opens full-screen.

**iPhone / iPad (Safari, not Chrome)**
1. Open the app link in **Safari**.
2. Tap the **Share** button (square with an up arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.

**Windows / Mac:** open the link in Chrome or Edge and click the install icon in the address bar.

The app refreshes whenever you open it, checks for new data every 5 minutes while it's open, and
shows the last loaded data when you're offline. Items that are new since your last visit have a red dot.

## Optional: push alerts to your phone (free)

1. Pick a hard-to-guess topic name, for example `techpulse-7f3k9q2`.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
   Name: `NTFY_TOPIC`, value: your topic name.
3. Install **ntfy** (Play Store / App Store), tap **+ / Subscribe**, and enter the same topic.

You'll get at most 3 alerts per run, only for major items such as model launches, actively
exploited vulnerabilities and big Hacker News stories. To also get job alerts, add keywords to
`alerts.job_keywords` in `sources.json`, e.g. `["python", "android", "data engineer"]`.

## Optional: more jobs from Adzuna (India and other countries)

1. Register at https://developer.adzuna.com/ (free) to get an **App ID** and **App Key**.
2. Add the repo secrets `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.

## Customize

Edit `sources.json` on GitHub (pencil icon) and commit. The site rebuilds automatically, and
the app needs no update.

- **Add a news feed:** copy any `"type": "rss"` line in `news` and change `id`, `name`, `url`
  and `category`.
- **Add a company's jobs:** add `"slug:Name"` to the right list. The slug is in the company's
  careers URL: `boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>` or `jobs.ashbyhq.com/<slug>`.
- **Track a GitHub project's releases:** add `"owner/repo"` to `repos`.
- **New topic tab:** add an entry to `categories` with keywords. It appears in the app automatically.

## Notes

- LinkedIn, Naukri and Indeed have no public job APIs and forbid scraping, so they aren't included.
- The app shows headlines, short excerpts and links to the original articles, not full articles.
- GitHub pauses scheduled jobs in repos with no commits for 60 days. The workflow commits a tiny
  `.keepalive` file when needed to prevent that.
- Your saved items, skills and settings stay on your device.

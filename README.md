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
- **.NET & Azure:** official .NET, Azure, Azure SDK, Visual Studio and Azure DevOps blogs, plus
  community experts (Andrew Lock, Milan Jovanović, Code Maze, Scott Hanselman, The Morning Brew)
  and .NET / ASP.NET Core / EF Core / MAUI / Aspire releases.
- **Learn:** pick a language (23 of them, including C#/.NET, ASP.NET Core, Azure, React, Angular,
  Python, Java, SQL, Go and more), then a mode:
  - **Fundamentals:** a complete course from basics to advanced, chapter by chapter
    (`fundamentals/<topic>--NN.md`). Each concept has an explanation, example code, pitfalls and a
    link to the official docs.
  - **Official docs:** sections of the official documentation (Microsoft Learn, MDN, react.dev,
    angular.dev, Python, Kotlin, Swift, Rust by Example, Docker, Kubernetes, Dart, Flutter, Go and more), pulled
    daily from their open-licensed repositories. The license is checked on every run.
  - **Interview:** curated answers linked to official docs, plus open-licensed collections (React: MIT,
    JavaScript: BSD, System Design Primer: CC BY 4.0). The fetcher checks each repo's license before using it.
  - **Scenario:** "how would you…" troubleshooting and design questions.
  - **Top Q&A:** highest-voted Stack Overflow questions with accepted answers, shown with author,
    votes and license (CC BY-SA 4.0).
  - **Latest:** answered Stack Overflow questions from the past 30 days.
  - Mark questions as **known** to track your interview prep.
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

## Refresh button: sync everything from your phone

- **Without setup:** Refresh instantly pulls the newest Hacker News and dev.to stories straight into
  the app. Other sources update on the server schedule.
- **With a token (recommended, one time per device):** Refresh also starts the full server sync
  (all blogs, releases, jobs and Q&A). The status line shows *Syncing all sources…* and the app
  reloads by itself when the sync finishes, about 3 minutes later.
  1. In the app, open **Settings → Full sync from Refresh → Create a token on GitHub**.
  2. Repository access: **Only select repositories → techpulse**. Permissions: **Actions → Read and write**.
     Nothing else is needed.
  3. Click **Generate token**, copy the token, and paste it into the box in Settings. It should say *✓ Token works*.

  The token is stored only on that device. It can do nothing except start this repo's workflow.
  Pressing Refresh again within 5 minutes won't start a second sync.

## Recommended: guaranteed 15-minute syncs (free)

GitHub's built-in schedule is best-effort. In new or quiet repos it can be hours late or skipped.
A free external timer that starts the workflow directly makes syncing reliable.

1. **Create a token.** Go to GitHub → profile picture → **Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token**.
   - Name: `techpulse-trigger`. Expiration: 1 year.
   - Repository access: **Only select repositories → techpulse**.
   - Permissions: **Actions → Read and write**. Nothing else is needed.
   - Click **Generate** and copy the token.
2. **Create the timer.** Sign up free at https://cron-job.org and click **Create cronjob**:
   - URL: `https://api.github.com/repos/<your-username>/techpulse/actions/workflows/update.yml/dispatches`
   - Schedule: every 15 minutes.
   - **Advanced** tab: request method **POST**, request body `{"ref":"main"}`, and these headers:
     - `Authorization: Bearer <your token>`
     - `Accept: application/vnd.github+json`
     - `User-Agent: techpulse`
   - Save, then click **Test run**. You should get status **204**, and a new run appears in the **Actions** tab.

The token stays inside cron-job.org. It is never put in the app or the repo.

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

## Recommended: Stack Overflow API key (free)

Without a key, Stack Overflow allows 300 requests a day per IP address, and GitHub's servers share
IP addresses. With a key the limit is 10,000.
1. Log in to https://stackapps.com/apps/oauth/register with a Stack Overflow account and register an
   app (any name; use your GitHub Pages URL as the website).
2. Copy the **Key** (not the client secret) into a repo secret named `STACKEXCHANGE_KEY`.

## Add your own interview questions

Edit `interview/<topic>.md` on GitHub, e.g. `interview/csharp.md`. Each question looks like this:

```
### What is dependency injection?
<!-- level: basic; kind: concept; ref: https://learn.microsoft.com/dotnet/core/extensions/dependency-injection -->
Your answer. Lists and fenced code blocks work.
```

`kind: scenario` puts it in the Scenario list. The file name must match a topic id in `learn_topics`
in `sources.json` (csharp, aspnet, azure, react, angular, python, sql, …).

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

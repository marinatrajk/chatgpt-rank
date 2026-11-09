# gpt-checker

Asks **chatgpt.com itself** a list of queries in a real browser and reports whether a brand is mentioned in each answer: yes or no, which name matched, where (character position and line), and the sentence around it. It sees what ChatGPT users see, product cards included, which the OpenAI API doesn't return. No OpenAI API is used.

It runs in Docker: a headed Chromium on a virtual screen (Xvfb) that you can watch, and take over, from your own browser through noVNC.

> **Before you use it:** OpenAI's terms don't allow automated use of ChatGPT. Use it gently (it runs at most 10 queries per run, one at a time) and, if you log in, use a dedicated account. It doesn't disguise itself or get past verification checks or limits: when ChatGPT shows one, the run stops, saves a screenshot and reports it.

## Setup

With Docker installed, from this folder:

```bash
docker compose build
```

Put your queries in `data/pairs.json`: up to 10 per run, each with the brand and the names that count as a mention.

```json
[
  { "brand": "K18", "variants": ["K18", "FutureIQ"], "query": "best hair longevity serum" },
  { "brand": "K18", "variants": ["K18"], "query": "best bond repair hair treatment" }
]
```

Names match case-insensitively as whole words, so `K18` doesn't match `K180` or `k18hair`. Spaces and dashes between letters and digits are optional (`K-18`, `K 18`). Names of 5+ characters also match with one typo (`Olaplx`), reported as `fuzzy`.

## Run a check

```bash
docker compose run --rm --service-ports gpt-checker npm run check
```

Watch it at http://localhost:6080/vnc.html while it runs. Each query starts as a new visitor: ChatGPT's cookies, storage and cache are cleared first, so nothing from earlier queries carries over (`--keep-session` turns that off; logged-in runs keep the session and use Temporary Chat instead, since clearing would log out). The answer is read once ChatGPT has finished streaming (2 minute limit), and there's a 15 s pause between queries, so 10 queries take about 6 minutes. A query that fails is logged and skipped; a verification check or limit stops the run. If runs start hitting limits, lengthen the pause with `--delay`. One run at a time: while a run (or `login`) is using the browser profile, another refuses to start. If a run was killed, its lock in `user-data/.gpt-checker.lock` expires after 45 minutes, or you can delete it.

Options go after `--`: `npm run check -- --delay 60`, `--pairs data/other.json`, `--keep-session`, `--no-temporary`.

At the end it prints a table, one line per pair:

```
K18 · best serum for thinning hair                           NO
K18 · best bond repair hair treatment                        YES (line 1/77)
```

## What it writes (in `data/`)

| File | |
|---|---|
| `reports/report-<YYYYMMDD-HHmmss>.json` and `.csv` | one row per pair: timestamp, query, brand, mentioned, variant matched, position, line, sentence, citations, whether it only appeared in an ad, and the transcript and screenshot paths |
| `reports/history.csv` | the same rows from every run, appended, to track results over time |
| `summary.md` | each pair's latest result next to the previous run's: ▲ newly mentioned, ▼ dropped, or unchanged, plus how often it was mentioned across all runs. `npm run summary` rebuilds it |
| `transcripts/` | each full answer, with its source pills, product links and any ads shown next to it |
| `screenshots/` | the page at the start of each run and after every answer, check or error |
| `run.log` | everything printed, with timestamps |

**Citations:** ChatGPT shows sources as pills ("Allure +3") whose links only load when you open them, so the report records the source names, plus the URLs of product and shop links in the answer.

**Ads:** ChatGPT can show ads next to an answer. A brand that only appears in an ad counts as not mentioned, with `in_ad` set to yes.

## Logging in (optional)

Without a login, `check` uses logged-out ChatGPT: what a new visitor sees, with no memory or history shaping the answer. That's a good baseline for brand checks.

To use an account:

```bash
docker compose run --rm --service-ports gpt-checker npm run login
```

Open http://localhost:6080/vnc.html, log in (2FA included), and close the window. The session is kept in `user-data/`, and every `check` reports whether it's still logged in. When logged in, each query goes in a Temporary Chat so the account's memory doesn't colour the answers.

In testing, OpenAI's login page (auth.openai.com) showed a Cloudflare check that fails for automated browsers even when a person clicks it, so expect the login to be refused.

## Run it on a schedule

On an always-on machine, add a crontab line on the host (`crontab -e`). This runs at 9:00 and 17:00:

```
0 9,17 * * * cd /path/to/gpt-checker && docker compose run --rm -T gpt-checker npm run check >> data/cron.log 2>&1
```

`check` exits with code 2 when a verification check or limit stopped the run, if you want cron to alert you.

A machine on an ordinary office or home connection gets far fewer checks than a cloud server. On a server, keep port 6080 on 127.0.0.1 (as in `compose.yaml`) and reach the viewer through an SSH tunnel: `ssh -L 6080:localhost:6080 your-server`. If you expose it, set `VNC_PASSWORD` first.

## When ChatGPT changes its page

All selectors are in `src/selectors.ts`, and fixes go there only. To see the current markup:

```bash
docker compose run --rm gpt-checker npm run inspect -- --ask "test"
```

`npm test` checks the brand matching and the history and summary code.

## What it doesn't do

It doesn't type with fake human timing, randomise its pauses, rotate accounts or IP addresses, open parallel tabs, or solve CAPTCHAs. Those exist to hide automation from ChatGPT, and this tool doesn't hide.

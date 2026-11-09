# chatgpt-rank

See whether **ChatGPT recommends your brand**. Give it the questions your customers ask, like **"best bond repair hair treatment"**, and it asks each one in the real chatgpt.com, in a fresh logged-out browser. It tells you yes or no for each, where your brand appears and in what words, and which sources ChatGPT showed.

It uses the real site, not the OpenAI API, so it sees what a new visitor sees, product cards included. No API key is needed to run checks.

> **Before you use it:** OpenAI's terms don't allow automated use of ChatGPT. Use it gently: it runs at most 10 queries per check, one at a time, with a pause between them. It doesn't disguise itself or get past verification checks or limits. When ChatGPT shows one, the check stops, saves a screenshot and reports it.

## Quick start

You need [Node.js](https://nodejs.org) (the LTS version) and [Docker Desktop](https://www.docker.com/products/docker-desktop/), running.

1. **Get the code.** On GitHub, click **Code → Download ZIP** and unzip it (or `git clone` it).
2. **Open a terminal in that folder.** On a Mac, right-click the folder in Finder and choose **New Terminal at Folder**. On Windows, right-click the folder and choose **Open in Terminal**.
3. **Run setup:**

   ```bash
   npm run setup
   ```

   It installs everything, builds the browser that runs the checks (a few minutes the first time), asks for an optional OpenAI key, then opens the app in your browser.

Next time, start Docker Desktop, run `npm run dev` in the same folder, and open http://localhost:3000.

**The OpenAI key is optional.** It only writes suggested queries from your brand name or website. Without it, click **Write my own** and type them. Get one at https://platform.openai.com/api-keys, and add, replace or remove it any time on the app's **Settings** page. It's saved in `.env.local` in this folder (git ignores it) and sent only to OpenAI. The app only listens on your own computer, so other people on your network can't open it.

### If something goes wrong

- **`npm: command not found`**: install Node.js from https://nodejs.org, then open a new terminal window.
- **"Docker isn't running"**: open Docker Desktop and wait until it says it's running, then try again.
- **The check stops with "verification check" or "limit"**: ChatGPT is asking to confirm you're human, or is limiting this connection. Wait a while before the next check. On a home or office connection you get fewer checks than on a server.
- **"didn't accept this key"**: copy the OpenAI key again. OpenAI shows a key only once, so you may need to create a new one.
- **Port 3000 is taken**: run `npm run dev -- -p 3001` and open http://localhost:3001.

## How a check works

1. **Type your brand or website.** For a website, the app reads the homepage's title and description first.
2. **Suggest queries** (needs the OpenAI key): a small OpenAI model writes 5 shopper questions that don't name the brand, plus the brand's other names that should count as a mention (product lines, spellings). Or click **Write my own**. Edit, remove or add queries, up to 10.
3. **Run in ChatGPT:** each query is asked in logged-out chatgpt.com, one at a time, each as a new visitor (cookies and storage cleared first), with a 15-second pause between them. 10 queries take about 6 minutes. Progress shows live, and **Watch live** opens the browser it's driving.
4. **The report** says yes or no per query, where the brand first appears, ChatGPT's sentence about it, and its sources. Click a query for the full answer with the brand highlighted. Every check is saved and listed in the sidebar.

One check runs at a time.

**Matching:** names match case-insensitively as whole words, so `K18` doesn't match `K180`. Spaces and dashes between letters and digits are optional (`K-18`, `K 18`). Names of 5+ characters also match with one typo (`Olaplx`), reported as fuzzy.

**Ads:** ChatGPT can show ads next to an answer. A brand that only appears in an ad counts as not mentioned.

**Sources:** ChatGPT shows sources as pills ("Allure +3") whose links only load when opened, so the report records the source names, plus the URLs of product and shop links in the answer.

## Good to know

- **Answers vary.** The same question can name different products from one check to the next. Run the same queries over a few days before drawing conclusions. `gpt-checker/data/summary.md` compares each query with its previous result.
- **Logged out is the baseline.** No memory, history or personalisation shapes the answer, which is what a new visitor sees.
- **Everything is saved in `gpt-checker/data/`:** reports as JSON and CSV, a `history.csv` across all checks, full transcripts, and screenshots.
- **From the command line or on a schedule:** the checker in [`gpt-checker/`](gpt-checker/README.md) runs without the web app, from a list of queries in a JSON file. Its README covers running it from cron and fixing it when ChatGPT changes its page.

## Project layout

```
src/
  app/
    page.tsx                 brand or website, suggested queries, live progress, report, past checks
    settings/page.tsx        paste, check and remove the OpenAI key
    api/chatgpt/             suggest (OpenAI queries), runs (start a check, list reports), transcript
    api/settings/route.ts    key status (last 4 characters only) and saving it to .env.local
  components/                AppNav, CheckReportView
  lib/
    chatgpt-check.ts         runs gpt-checker in Docker and reads its reports
    suggest-queries.ts       an OpenAI model turns a brand or website into shopper queries
    api-keys.mjs             the key, checking it with OpenAI, writing .env.local (shared with setup)
scripts/setup.mjs            `npm run setup`: Node, install, Docker image, key, start
gpt-checker/                 Docker + Playwright runner that asks chatgpt.com itself (own README)
```

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run typecheck` here and `npm test` in `gpt-checker/`. If ChatGPT changes its page and checks break, the fix usually belongs in `gpt-checker/src/selectors.ts`.

## License

[MIT](LICENSE)

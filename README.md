# GEO Tool

A local web app that shows which products ChatGPT, Claude and Gemini recommend for a shopper-style question like **"best shampoo for hair loss"**.

You type the question once, plus your brand if you want it checked (e.g. **K18**). The app asks each assistant several times (answers vary from run to run), then has Claude read every answer and pull out the products. You get:

- **Your brand, yes or no**: whether your brand is named, in how many answers per assistant, at what position, in what words, and whether your own site was cited. If it isn't named, you see who was named instead. You can type a different brand on any saved run.
- **Products**: every product named, ranked by visibility, showing for each assistant how many answers mentioned it ("2/3") and its average position in the list ("avg #1.5"). Click a row to see the exact quote from each answer.
- **Brands**: the same view rolled up by brand.
- **Sources**: which websites the assistants cited. These are the pages that shape the recommendations. For Claude these are the pages its searches returned: its current search tool filters results in a code sandbox and doesn't attach citations to the answer.
- **Answers**: the full text of every answer, with the products in order, the sources, and the web searches the assistant chose to run. Your prompt is sent to each assistant word for word; the searches are the assistant's own.
- **Export CSV** of the product table, plus a history of past runs (saved in `data/runs/`).

## Quick start

You need [Node.js](https://nodejs.org) (the LTS version) and an Anthropic API key. OpenAI and Google keys are optional: add them to also check ChatGPT and Gemini.

1. **Get the code.** On GitHub, click **Code → Download ZIP** and unzip it (or `git clone` it).
2. **Open a terminal in that folder.** On a Mac, right-click the folder in Finder and choose **New Terminal at Folder**. On Windows, right-click the folder and choose **Open in Terminal**.
3. **Run setup:**

   ```bash
   npm run setup
   ```

   It installs everything, asks for your API keys and checks each one with its vendor, then opens the app in your browser.

Next time, run `npm run dev` in the same folder and open http://localhost:3000.

| Key | Get it at | Needed for |
|---|---|---|
| Anthropic | https://platform.claude.com/settings/keys | Claude, **and reading the answers (required)** |
| OpenAI | https://platform.openai.com/api-keys | ChatGPT |
| Google | https://aistudio.google.com/apikey | Gemini |

You can add, replace or remove keys any time on the app's **Settings** page. An assistant without a key is greyed out.

**Where your keys go:** they're saved in `.env.local` in this folder (git ignores it) and sent only to their own vendor. The app only listens on your own computer, so other people on your network can't open it or spend your credits.

**The "Check a brand in ChatGPT" page** also needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) running. Everything else works without Docker.

### If something goes wrong

- **`npm: command not found`**: install Node.js from https://nodejs.org, then open a new terminal window.
- **"didn't accept this key"**: copy the key again. Some vendors show a key only once, so you may need to create a new one.
- **The key is saved but runs fail**: the vendor account probably has no credits. Add billing in the vendor's console.
- **Port 3000 is taken**: run `npm run dev -- -p 3001` and open http://localhost:3001.

### Models

Set these in `.env.local` (`.env.example` lists them), then restart the app.

| Assistant | Default model | Override with |
|---|---|---|
| ChatGPT | `gpt-6.1-sol` | `OPENAI_MODEL` |
| Claude | `claude-opus-5-5` | `ANTHROPIC_MODEL` |
| Gemini | `gemini-3.8-flash` | `GEMINI_MODEL` |
| Product extraction | `claude-opus-5-5`, effort `medium` | `ANALYZER_MODEL`, `ANALYZER_EFFORT` |
| Query suggestions (ChatGPT check) | `claude-haiku-5-5`, effort `low` | `QUERY_MODEL` |

Requests to Claude Opus 5.5 opt into Anthropic's server-side fallback (`fallbacks: "default"`): if a safety classifier declines a request, it is retried on Anthropic's recommended fallback model, and the answer card shows the model that actually answered. For product questions this should almost never trigger.

## Check a brand in ChatGPT

The second page (sidebar: **Check a brand in ChatGPT**, or `/chatgpt`) asks the real chatgpt.com instead of the APIs:

1. Type your brand or website. For a website, the app reads the homepage's title and description first.
2. **Suggest queries**: Claude Haiku writes 5 shopper questions that don't name the brand, plus the brand's other names that should count (product lines, spellings). Edit, remove or add queries (up to 10).
3. **Run in ChatGPT**: runs [`gpt-checker/`](gpt-checker/README.md) in Docker with those queries, one at a time in logged-out ChatGPT, each as a new visitor. Progress shows live, and **Watch it live** opens the browser it's driving.
4. The report says yes or no per query, where the brand first appears, ChatGPT's sentence, and its sources. Click a query for the full answer with the brand highlighted. Every check is saved and listed in the sidebar.

It needs Docker running; the first run builds the gpt-checker image. One check runs at a time.

## How the numbers work

- **Mentions ("2/3")**: answers from that assistant that name the product, out of its successful answers.
- **Avg position ("avg #1.5")**: where the product appears among the products in each answer, averaged over the answers that mention it. #1 = named first.
- **Visibility**: the mention rate averaged across the assistants in the run, so each assistant counts equally. 100% = every answer from every assistant named it.
- **Stance**: Claude tags each mention as recommended, mentioned in passing, or warned against. Warnings show as a red "warned against" badge.

## Good to know

- **The API is not the consumer app.** ChatGPT, claude.ai and the Gemini app add their own system prompts, memory, personalisation and shopping features, and may route to different models. This tool asks the models directly through each vendor's API with web search turned on, which gets close to what a logged-out new user sees, but not identical. For answers from chatgpt.com itself, product cards included, use [`gpt-checker/`](gpt-checker/README.md): it runs logged-out ChatGPT in a headed browser in Docker and reports brand mentions per query. Services such as DataForSEO's ChatGPT scraper return real chatgpt.com answers over an API.
- **Assistants don't always search.** With web search on, an assistant may still answer from memory. Those answers say so under Answers.
- **Answers vary.** Run 3 or more times per assistant before drawing conclusions. The same question can produce a different top pick from one run to the next.
- **Country** localises web search for ChatGPT and Claude. Gemini's Google Search grounding has no location setting, so it searches from wherever Google decides.
- **Turn web search off** to see what each model recommends from its training data alone.
- **Extraction is done by an LLM.** It is usually right, but check the quotes when a result looks surprising, for example if two product variants were merged or split.
- **Cost:** each answer is one API call with web search, and each run adds one extraction call over all the answers. 3 runs × 3 assistants = 9 answers + 1 extraction. Check each vendor's pricing page for current rates.

## Project layout

```
src/
  app/
    page.tsx                 UI: form, live progress, results, history
    api/runs/route.ts        POST starts a run and streams progress (NDJSON); GET lists past runs
    api/runs/[id]/route.ts   GET / DELETE one saved run
    api/config/route.ts      which assistants have keys, and their models
    chatgpt/page.tsx         the ChatGPT check: brand or website, suggested queries, live progress, report
    api/chatgpt/             suggest (Haiku queries), runs (start a gpt-checker run, list reports), transcript
    settings/page.tsx        paste, check and remove API keys
    api/settings/route.ts    key status (last 4 characters only) and saving keys to .env.local
  components/                RunForm, Progress, Results (tables + answers), History, AppNav, CheckReportView
  lib/
    providers/               openai.ts, anthropic.ts, gemini.ts: one call per answer, with web search
    analyze.ts               Claude structured-output extraction of products and mentions
    aggregate.ts             turns mentions into the product / brand / source tables
    run.ts                   runs every assistant × repetition (6 at a time), then extracts
    storage.ts               saves runs as JSON in data/runs/
    suggest-queries.ts       Claude Haiku turns a brand or website into shopper queries
    chatgpt-check.ts         runs gpt-checker in Docker and reads its reports
    api-keys.mjs             the keys, checking them with each vendor, writing .env.local (shared with setup)
scripts/setup.mjs            `npm run setup`: Node check, install, keys, start
gpt-checker/                 Docker + Playwright runner that asks chatgpt.com itself (own README)
```

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run typecheck` here and `npm test` in `gpt-checker/`. If ChatGPT changes its page and the browser check breaks, the fix usually belongs in `gpt-checker/src/selectors.ts`.

## License

[MIT](LICENSE)

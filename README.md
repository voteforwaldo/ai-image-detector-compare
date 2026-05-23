# AI Image Detector — Dual Compare

A small web tool styled like [AI or Not](https://aiornot.com) that analyzes the same uploaded image **in parallel** with:

1. **AI or Not API** — official `ai_generated` report (verdict + AI/human confidence %)
2. **Google Gemini** — vision model with an “is it AI?” prompt

Results appear side by side on one page.

## Why a small server?

API keys must not live in public GitHub Pages JavaScript (anyone could steal them). Browsers also cannot call `api.aiornot.com` directly due to CORS. This repo includes:

- **`dev-server.mjs`** — локален HTTP сървър (`public/` + `/api/*`)
- **`api/*.mjs`** — Vercel serverless API (production)
- **`api/analyze.js`** — Vercel serverless (free tier)

The static UI is in `public/`.

## Quick start (local)

```bash
cd ai-image-detector-compare
cp .env.example .env
# Edit .env with your keys:
#   AIORNOT_API_KEY=...
#   GEMINI_API_KEY=...

npm start
```

Open http://localhost:3000 — upload an image. Analysis runs automatically.

Alternatively, open **Settings** and paste keys (stored in `sessionStorage` only for that tab).

## Deploy to GitHub + Vercel (recommended)

1. Create a new GitHub repo and push this folder.
2. Import the repo in [Vercel](https://vercel.com).
3. Add environment variables:
   - `AIORNOT_API_KEY`
   - `GEMINI_API_KEY`
4. Deploy. Vercel serves both the UI (`public/`) and `/api/analyze`.

No keys in the browser required when env vars are set on Vercel.

## GitHub Pages only (UI mirror)

GitHub Pages can host the static files, but **analysis will not work** unless you point the UI at a backend URL. For a Pages-only deploy, add to `public/index.html` inside `<head>`:

```html
<meta name="api-base" content="https://your-vercel-app.vercel.app" />
```

Then use a GitHub Actions workflow or the Pages setting with `/public` as the source.

## API references

- AI or Not: https://docs.aiornot.com/ — image endpoint `POST https://api.aiornot.com/v2/image/sync?only=ai_generated`
- Gemini: https://ai.google.dev/gemini-api/docs — model `gemini-2.5-flash`

## Security

- Never commit `.env` or API keys.
- Prefer server environment variables in production.
- Session-stored keys in Settings are for personal/local use only.

## License

MIT — use at your own risk; detection scores are indicative, not legal proof.

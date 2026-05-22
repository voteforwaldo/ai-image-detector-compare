# Vercel: „unexpected token T“ / not valid JSON

This error is **almost never** from your code. It usually means Vercel tried to parse **environment variables as JSON** and failed.

## Fix (5 minutes)

### 1. Delete all environment variables

1. [vercel.com](https://vercel.com) → your project → **Settings** → **Environment Variables**
2. Delete **every** variable (⋯ → Remove)
3. Save

### 2. Add them again — one by one (NOT bulk JSON)

Use the normal form: **Key** + **Value** fields.  
**Do not** paste your `.env` file into an „Import JSON“ box.

| Key | Value |
|-----|--------|
| `AIORNOT_API_KEY` | your key (no quotes) |
| `GEMINI_API_KEY` | your key (no quotes) |
| `GEMINI_MODEL` | `gemini-3.5-flash` (optional) |
| `SITE_PASSWORD` | your password (**задължително** за вход с парола; без нея сайтът е отворен) |

For each variable, tick **Production** (and Preview if you want).

**Important:** If your password starts with letters (e.g. `TheSecret123`), that is fine in the **Value** field. It only breaks when pasted as **invalid JSON** like:

```json
SITE_PASSWORD=TheSecret123
```

(JSON needs quotes: `"value": "TheSecret123"`)

### 3. Node.js version

In Vercel → **Settings** → **General** → **Node.js Version** → **20.x** (задължително за ExifTool).

### 4. Redeploy

**Deployments** → latest → **⋯** → **Redeploy**

### 5. `SERVICE_UNAVAILABLE` при качване

- Обикновено **`/api/analyze` е паднал** (твърде голям файл, timeout или още не е deploy-нат последният fix).
- На Vercel лимитът за тяло на заявката е **~4 МБ** — ползвайте по-малко изображение.
- Уверете се, че **Node.js 20.x** е избран и последният commit е deploy-нат.
- Проверка: `https://ВАШИЯТ-проект.vercel.app/api/health` → `{"ok":true}`.

---

## If you must import as JSON

Use the file `vercel-env-import.example.json` in this repo — copy it, replace `REPLACE_ME`, import that file only.

---

## Still failing?

In the failed deployment, open **Building** logs and check the **first red line**.  
Send that line (no API keys) for help.

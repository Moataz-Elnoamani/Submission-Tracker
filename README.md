# MN Submission Portal

Front end for the Opus workflow **"MN" Submission Tracker**
(`23a4ac11-3fe8-4172-a317-4422e8040de6`). Participants log their weekly workflow
submissions here; the portal starts an Opus case with a participant name, so
**Classify Trigger Scenario** routes it to **Log Submission To Tracker**, which
writes the entry into the latest dated tab of the tracker sheet.

Managers get a separate view (top-right **Manager access**) with every run,
the full tracker with links, and actions to clear entries, delete run records
and email a participant.

```
GitHub Pages (static, public)           Cloudflare Worker (holds the secrets)
┌──────────────────────────┐   HTTPS    ┌───────────────────────────────┐
│ index.html  assets/…     │ ─────────▶ │ worker/src/index.js           │
│ config.js: API_BASE only │            │  ├─ Opus Cases + Files API    │
└──────────────────────────┘            │  ├─ Google Sheets (read/clear)│
          │ PUT file bytes              │  ├─ Gmail (manager notes)     │
          └──────────▶ Opus presigned URL  └─ KV "RUNS" (run log)       │
                                        └───────────────────────────────┘
```

GitHub Pages can only serve static files, so it can't keep an Opus service key
or Google tokens private. The worker keeps them as encrypted secrets and is
the only thing that calls Opus, Sheets and Gmail.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page: box-in-box layout, participant form, manager shell |
| `assets/css/styles.css` | Applied AI / Opus theme, light + dark tokens, responsive rules |
| `assets/js/config.js` | **The file you edit**: `API_BASE`, titles, limits. Nothing secret |
| `assets/js/api.js` | API client + built-in demo data (used while `API_BASE` is empty) |
| `assets/js/app.js` | All UI logic (vanilla JS, no build step) |
| `assets/img/` | Applied AI lockup (black/white), Opus wordmark and cube, transparent PNGs |
| `worker/src/index.js` | The API worker |
| `worker/wrangler.toml` | Worker config: non-secret vars, KV binding, list of secrets |

## 1. Preview right away (demo mode)

Push the repo, enable **Settings → Pages → Deploy from branch → main / (root)**.
With `API_BASE: ""` in `config.js` the portal runs on sample data (a blue
*Demo data* pill shows in the header). Manager passcode in demo mode: `demo`.

Locally: `python3 -m http.server` in the repo folder, then open
`http://localhost:8000`.

## 2. Connect Opus — on Vercel (recommended)

The `api/[...path].js` Vercel Function serves every `/api/*` route using the
same code as the worker, so the portal and its API deploy together.

1. **Opus API key:** in Opus, click the Opus button (top left) → **Channels → API**
   → **+ Generate API Key**. Copy it — it is shown once.
2. **Vercel → Project → Settings → Environment Variables** (Production + Preview):

   | Name | Value |
   |---|---|
   | `OPUS_SERVICE_KEY` | the key from step 1 |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | the Google OAuth app used by the workflow (Sheets + Gmail scopes) |
   | `MANAGER_PASSCODE` | what managers type in the portal |
   | `TOKEN_SECRET` | any long random string |

   Optional overrides: `OPUS_BASE_URL` (default `https://operator.opus.com`),
   `OUTPUT_MAP`, `PARTICIPANTS`, `MANAGER_EMAIL`, `ALLOWED_ORIGINS`.
3. **Run log (manager Runs tab):** Vercel → **Storage → Create → Upstash (Redis)**
   → connect it to the project. It adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
   Submissions still work without it; only the Runs tab needs it.
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect, then
   open `https://submission-tracker-five.vercel.app/api/health`.

`config.js` already points `API_BASE` at the Vercel URL, so both the Vercel site
and the GitHub Pages copy use it.

## 2b. Alternative — deploy as a Cloudflare Worker

```bash
cd worker
npm i -g wrangler          # or use npx
wrangler login
wrangler kv namespace create RUNS      # paste the id into wrangler.toml
# edit ALLOWED_ORIGINS in wrangler.toml → https://<your-user>.github.io

wrangler secret put OPUS_BASE_URL          # https://operator.opus.com
wrangler secret put OPUS_SERVICE_KEY       # Opus x-service-key
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN   # Sheets read/write + Gmail send scopes
wrangler secret put MANAGER_PASSCODE
wrangler secret put TOKEN_SECRET           # any long random string
wrangler deploy
```

Then set `API_BASE` in `assets/js/config.js` to the worker URL it prints and push.
Check `https://<worker-url>/api/health` returns `{"ok":true}`.

> Cases started through the API run the workflow's **published** version —
> publish in the Builder after any change.

## 3. How a submission maps to the workflow

| Portal field | Workflow input | Payload type |
|---|---|---|
| Your name | `workflow_input_a3x9ovt9x` Participant Name | `str` |
| Topic (Topic 1 / Topic 2, titles read from the sheet) | `workflow_input_rlcwgx5g0` | `str` (`"Topic 1"` / `"Topic 2"`) |
| Main workflow link | `workflow_input_vw0ueu1n9` | `str` |
| + Add → Sub-workflow link (max 3) | `workflow_input_j2cneh7id` | `object` `{"0":…, "1":…, "2":…}` |
| + Add → Attach file (max 10) | `workflow_input_vbdiikkh1` | `array` of Opus `fileUrl`s + `typeDefinition` |
| Notes | `workflow_input_fzwjlypey` | `str` (plain text, not hyperlinked) |

Empty optional inputs are left out of the payload. The *Sheet cell preview*
under the form shows the same `Main Workflow - Sub-Workflow 1 - File (1) - note`
text the Log node writes. The portal validates the same rules the node does
(Builder-link marker, something to log) so most failures are caught before a
case is started.

Sub-workflow links are capped at 3 because that input is `object{0,1,2}`. To
allow more, change it to a List in the Builder and raise `MAX_SUB_WORKFLOWS` in
both `config.js` and the worker.

## 4. Manager view

| Tab | What it does |
|---|---|
| Overview | Completion, submitted / excused / missing for the selected week, per-topic bars, completion over the last 6 weeks, actions: run the scheduled check now, clear the week (type the tab name to confirm), purge the run log |
| Tracker | Every participant × topic with status, the actual links and notes from the sheet. Per row: **Send note** (email, optionally with their status) and **Clear** (Topic 1, Topic 2 or both) |
| Runs | Every portal submission with Opus case status. Search, filter, view details (links, warnings, raw results), send a note, delete the record |

*Clear* empties the topic block (C:G or I:M) in the sheet — values and links
only; merges, formatting, names and titles stay. *Delete record* only removes
the portal's log entry, never the sheet. Sessions last 8 hours.

## Recommended workflow changes

1. **Map the Output node.** Right now the Output node maps nothing (the export
   lists six unmapped inputs), so a case returns no result and the portal can
   only say "Completed". Add Output variables mapped from *Log Submission To
   Tracker* — `log_status`, `target_tab`, `target_cell_main`, `error_output` —
   publish, then put their IDs in the worker's `OUTPUT_MAP`:
   ```toml
   OUTPUT_MAP = '{"log_status":"workflow_output_…","target_tab":"workflow_output_…","target_cell_main":"workflow_output_…","error_output":"workflow_output_…"}'
   ```
   The portal then shows the exact cell and flags a failed write (e.g. name not
   found) even when the case itself completes.
2. **Move the credentials out of the nodes.** The Google client secret and
   refresh token are typed into every Code Node as set values. Put them in
   workspace shared variables (secrets) and link those instead — and rotate them,
   since they have been shared in exported JSON.

## Customising

Colours are CSS tokens at the top of `styles.css` (`:root` for light,
`:root[data-theme="dark"]` for dark). The accent is Safety Blue `#387BF0`; status
colours are Code Green / Yellow in dark mode per the brand pairings. Fonts fall
back from Telegraf / Neue Montreal to Prompt / Open Sans. The front box is 80 %
of the dimmed stage (`.stage` padding of 10 vh / 10 vw).

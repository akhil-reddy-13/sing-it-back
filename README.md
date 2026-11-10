# Sing It Back

A reproducible web experiment on **long-term memory for musical pitch**. Participants sing songs they know well from memory, and the browser measures how close they come to the key of the original recording (after Levitin, 1994). They also try to name isolated piano notes and describe their language and music background. The goal is to test whether tone-language experience helps people **name** pitches, **remember** them, or both.

- Full study design, hypotheses and analysis plan: **[docs/PROTOCOL.md](docs/PROTOCOL.md)**
- Stanford Music 1A project (Akhil Reddy, Fall 2026), developed with [Faculty PI] toward an IRB-approved study

## How it works

```
browser                                            server (Vercel)
───────                                            ───────────────
mic (no echo-cancel / noise-suppress / AGC)
 └ resample → 16 kHz → YIN pitch track (10 ms)
    └ score vs songs.json reference ───────────►  POST /api/event  → Postgres (append-only)
       (template DTW / key profile / first note)   POST /api/audio  → only with separate consent
                                                   GET  /api/export → researchers (token)
analysis/ (Python): re-scores every stored pitch track with the current songs.json,
applies the preregistered exclusions and tests, and writes report.md + CSVs.
```

Only pitch measurements are uploaded by default, never audio. Raw tracks are kept, so if a reference melody is corrected later, all past data can be re-scored.

## Run it locally

```bash
npm install
npm run dev                          # http://localhost:3000, demo mode (nothing saved)
COLLECT_DATA=true npm run dev        # saves to ./data/events.ndjson
```

Pages:

- `/`: the participant study
- `/verify.html`: researcher tools for verifying reference songs and testing the scorer on your own voice

## Tests

```bash
npm test                             # pitch tracker + scorer on synthetic singers
node tests/make_parity_fixture.mjs && python3 tests/test_parity.py   # JS and Python scorers agree
COLLECT_DATA=true PORT=3123 npm run dev &  node tests/e2e.mjs http://localhost:3123
                                     # full study in headless Chrome, synthetic singer as the mic
python3 analysis/simulate.py && python3 analysis/analyze.py data/synthetic/events.ndjson \
   --songs data/synthetic/songs.json --out data/synthetic/report      # analysis pipeline on fake data
python3 analysis/simulate_power.py   # sample-size simulation
```

Python needs `numpy pandas scipy statsmodels matplotlib` (see `analysis/requirements.txt`).

## Deploy (Vercel + GitHub)

1. Push this folder to a **private** GitHub repository.
2. On vercel.com: **Add New → Project**, import the repo. No build settings are needed; `vercel.json` serves `public/` and the `api/` functions.
3. **Storage → Marketplace → Neon (Postgres)**, connected to the project. This sets `DATABASE_URL`. Create the tables once:
   `psql "$DATABASE_URL" -f db/schema.sql` (or paste `db/schema.sql` into Neon's SQL editor).
4. **Settings → Environment Variables:**

   | Variable | Value |
   |---|---|
   | `COLLECT_DATA` | `false` until the IRB approves, then `true` |
   | `STUDY_MODE` | `pilot` or `irb` (stored on every event) |
   | `IRB_PROTOCOL` | protocol number |
   | `ADMIN_TOKEN` | a long random string, e.g. `openssl rand -hex 32` |
   | `COLLECT_AUDIO` | `false` unless the IRB approves keeping audio |

5. Redeploy. While `COLLECT_DATA` is not `true`, the site shows a "demo mode" banner and saves nothing.

Download the data with `ADMIN_TOKEN=... python3 analysis/fetch_data.py https://<your-app>.vercel.app`, then run `python3 analysis/analyze.py --mode irb`.

## Before collecting real data

- [ ] IRB approval. Replace the placeholders in `public/consent.html` with the approved text.
- [ ] Verify every target song in `verify.html`: tonic, tuning in cents, chorus melody. Two people, independently (PROTOCOL section 5.3). **The keys in `songs.json` v0.1 are unverified guesses.**
- [ ] Human scorer check and device check (PROTOCOL section 11).
- [ ] Pilot, then update the power assumptions.
- [ ] Tag the release and preregister (OSF).

## Layout

```
public/            participant site (static)
  index.html, styles.css, consent.html, songs.json
  js/pitch.js      analysis core (YIN, scoring), shared with Node tests
  js/app.js        study flow            js/audio.js   mic + tone synthesis
  js/api.js        event queue/upload    js/verify.js  researcher tools
api/               Vercel serverless functions (config, event, audio, export)
lib/               storage (Postgres or local files) and HTTP helpers
db/schema.sql      tables
analysis/          Python: pitchlib (port), analyze, simulate, power, fetch, language codes
tests/             JS unit tests, synthetic singer, parity fixture, headless E2E
docs/PROTOCOL.md   the study framework / preregistration draft
```

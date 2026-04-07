# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive AI personality quiz for Halyk Bank's Demo Day, designed for public kiosks. Participants take a 7-question quiz to receive an AI personality profile and product recommendations. A live dashboard displays real-time aggregated statistics.

## Architecture

**No build step** — the frontend is pure static HTML/CSS/JS files. No framework, no bundler, no transpilation.

```
src/quiz.html         # Participant-facing quiz (single-page app)
src/dashboard.html    # Real-time analytics dashboard (kiosk TV display)
supabase/
  migrations/         # PostgreSQL schema + RLS policies + views
  functions/
    submit-quiz/      # Deno Edge Function: validation, scoring, persistence
scripts/
  configure.sh        # Patches HTML files with Supabase credentials
docs/DEPLOY.md        # Deployment guide (Russian)
```

## Commands

**Configure credentials** (patches `src/quiz.html` and `src/dashboard.html` with Supabase URL and anon key):
```bash
chmod +x scripts/configure.sh
./scripts/configure.sh <SUPABASE_URL> <ANON_KEY>
```

**Deploy Edge Function:**
```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy submit-quiz --no-verify-jwt
```
The `--no-verify-jwt` flag is required — public kiosks call the function without authentication.

**Apply database schema:**
Run `scripts/supabase-setup.sql` in the Supabase SQL Editor (or use `supabase/migrations/20260406_init.sql`).

## Key Architectural Decisions

### Server-Side Scoring Only
All scoring logic lives in `supabase/functions/submit-quiz/index.ts`. The client submits raw answers (`[{q: 0, a: 1}, ...]`) and the Edge Function recomputes scores — the client cannot manipulate results.

### Database Access Control
- RLS is enabled on `quiz_sessions` — only the service role (Edge Function) can read/write raw data
- Two public views expose aggregated/masked data readable by the anon key:
  - `quiz_stats`: Aggregated counts by profile and product
  - `quiz_feed`: Last 20 entries with PII masked (name → "Аноним" if anonymous)
- The anon key is safe to embed in `dashboard.html` because it only accesses these read-only views

### Demo Mode Fallback
Both HTML files detect unconfigured Supabase credentials (`YOUR_SUPABASE_URL` placeholder) and fall back to local demo mode — quiz shows results without saving, dashboard shows fake sample data.

### XSS Prevention
All user-supplied data is output via `textContent`, never `innerHTML`.

### Rate Limiting
In-memory map in the Edge Function: 1 submission per hashed IP per 60 seconds.

## Supabase Configuration

**Region:** EU Frankfurt  
**Realtime:** Enabled on `quiz_sessions` table (dashboard uses live subscriptions)  
**IP handling:** SHA-256 hashed, never stored raw

## Credential Placeholders

When the configure script hasn't been run, the HTML files contain these literal strings:
- `quiz.html`: `YOUR_SUPABASE_URL/functions/v1/submit-quiz`
- `dashboard.html`: `YOUR_SUPABASE_URL`, `YOUR_ANON_KEY`

# Dialektik Debate Suite

Local-first debate workspace for documents, evidence cards, match notes, practice rounds, and optional AI coaching.

This repository contains a full-stack debate training and team workspace. It is designed for local development first:
SQLite stores local data, AI provider keys stay server-side, and generated prompts can be copied manually when no paid
provider is configured.

## Highlights

- Debate workspace for documents, evidence, match preparation, practice rounds, and team administration.
- Optional AI coaching through mock, OpenAI-compatible, OpenClaw, or Anthropic providers.
- Admin dashboard for members, workspaces, provider status, audit logs, and AI usage estimates.
- Local-first setup with `.env.local` and SQLite files ignored by Git.

## Project Structure

- `apps/web`: Next.js app for the user workspace and admin dashboard.
- `packages/shared`: shared TypeScript types and sample data.
- `packages/ai`: provider wrappers, prompt builders, JSON normalization, and cost estimates.
- `packages/db`: Prisma client, SQLite loading, and seed scripts.
- `packages/editor`: minimal document JSON helpers and evidence-reference utilities.
- `prisma/schema.prisma`: SQLite-first schema, designed to migrate to Postgres later.

## Quick Start

Use Node.js 22 LTS for the smoothest local setup. From a fresh clone or a
downloaded ZIP, first make sure you are in the folder that contains
`package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/`, and `prisma/`.

Create local environment settings:

```powershell
copy .env.example .env.local
```

For a local mock-AI setup, `.env.local` should contain at least:

```env
AI_PROVIDER=mock
DATABASE_URL=file:./dev-mvp.db
SESSION_SECRET=change-this-local-secret
```

Optional seed account overrides can also be set in `.env.local`:

```env
SEED_ADMIN_EMAIL=admin@debate.local
SEED_ADMIN_NAME=Admin
SEED_ADMIN_PASSWORD=debate-admin-2026
```

Install dependencies, generate Prisma Client, sync the SQLite schema, seed
sample data, and start the web app:

```bash
corepack pnpm install
corepack pnpm --filter @debate/db prisma:generate
corepack pnpm --filter @debate/db prisma:push
corepack pnpm --filter @debate/db prisma:seed
corepack pnpm --filter @debate/db rooms:backfill
corepack pnpm dev
```

Open `http://localhost:3000`. The dev server binds to `0.0.0.0:3000`, so devices on the same LAN can use `http://<your-ip>:3000` if the firewall allows Node.js.

If you downloaded a ZIP from GitHub, Windows may create an extra wrapper folder.
Run the commands from the inner project folder. If `pnpm` prints
`No package.json found`, you are one directory too high.

## Local Login

Seed creates a local development owner account by default:

- Email: `admin@debate.local`
- Password: `debate-admin-2026`
- Role: `OWNER`

You can override the seed account by putting these values in `.env.local` before running `prisma:seed`:

```env
SEED_ADMIN_EMAIL=owner@example.local
SEED_ADMIN_NAME=Owner
SEED_ADMIN_PASSWORD=replace-with-a-local-password
```

Do not use the default password for any public or production deployment.

## AI Configuration

AI keys are server-only. Copy `.env.example` to `.env.local` and never create `NEXT_PUBLIC_*` API key variables.

```env
AI_PROVIDER=mock
DATABASE_URL=file:./dev-mvp.db
```

Supported providers:

- `mock`: no key required.
- `openai-compatible`: works with DeepSeek or other `/v1` compatible endpoints.
- `openclaw`: OpenAI-compatible wrapper with separate env names.
- `anthropic`: Anthropic SDK.

Example DeepSeek-style config:

```env
AI_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://api.deepseek.com/v1
OPENAI_COMPATIBLE_API_KEY=your_key
OPENAI_COMPATIBLE_MODEL=deepseek-chat
```

## Copy-Prompt Mode

The app can generate prompts without calling a paid API:

- Match room: choose evidence, add opponent context, click `Copy prompt`.
- Practice room: write a speech and copy an opponent prompt, or copy a feedback prompt after a transcript exists.

Users can paste these prompts into DeepSeek, ChatGPT, Claude, or another model manually.

## Current Feature Set

- Account registration and password login with opaque DB-backed sessions.
- Workspace-scoped documents, document body editing, and evidence cards.
- Match creation, speech notes, timer presets, and AI draft insertion after confirmation.
- Practice sessions with transcript, mode, rubric focus, opponent replies, feedback scoring, and copy-prompt fallback.
- Admin dashboard with role management, provider status, and AI usage estimates.

## Verification

```bash
corepack pnpm -r typecheck
corepack pnpm --filter @debate/web lint
corepack pnpm --filter @debate/web build
```

When changing Prisma models, run:

```bash
corepack pnpm --filter @debate/db prisma:generate
corepack pnpm --filter @debate/db prisma:push
corepack pnpm --filter @debate/db rooms:backfill
```

LAN HTTP is the default. Set `COOKIE_SECURE=true` only when the host is served through HTTPS.

## Safety Notes

- `.env.local`, `api.txt`, SQLite dev DBs, `.next`, `node_modules`, and `*.tsbuildinfo` are ignored by `.gitignore`.
- AI routes require login and filter data by workspace.
- Copy-prompt mode avoids provider cost, but users still decide what text they paste into external tools.

## Troubleshooting

- `No package.json found`: change into the actual project root, the directory
  that contains `package.json` and `pnpm-workspace.yaml`.
- `The table main.Session does not exist`: run
  `corepack pnpm --filter @debate/db prisma:push` with the same
  `DATABASE_URL` used by the web app, then run `prisma:seed`.
- Prisma engine download failures usually mean the connection to
  `binaries.prisma.sh` or `registry.npmjs.org` was interrupted. Retry after
  switching networks or enabling your normal development proxy.
- If Node.js 24 produces Prisma or Next.js runtime issues, switch to Node.js 22
  LTS and rerun `corepack pnpm install`.

## License

MIT. See [LICENSE](LICENSE).

# AI Provider Policy

- Never expose provider API keys in browser code or browser network payloads.
- All AI calls go through server-side routes or a local desktop backend.
- `.env.local` holds local secrets and is ignored by Git.
- `.env.example` documents variable names only.
- The product code calls the internal `AIProvider` interface instead of OpenClaw, OpenAI, or Anthropic directly.
- OpenClaw should be configured through the OpenAI-compatible adapter if its API is compatible.
- Anthropic/Claude should use the official `@anthropic-ai/sdk` adapter, not an OpenAI-compatible shim.
- AI-generated notes are drafts until a user confirms insertion.
- Structured outputs must be validated before writing to match notes, evidence, or statistics fields.

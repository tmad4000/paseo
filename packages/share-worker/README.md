# Snapshot share host

Deploy this Worker after the publisher PR merges. It serves only pre-rendered, redacted
snapshots; it has no route to the owner's daemon. The implementer does not deploy it.

Use the existing Wrangler 4.90.0 (published 2026-05-07), already in this repository's
lockfile. No new dependency version is introduced. Tests use the relay's Node/Vitest
conventions and structural binding types, without a Workers runtime emulator.

## Deployment

1. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in your deployment shell.
   Scope the token to the target account with **Account → Workers Scripts → Edit**
   and **Account → Workers KV Storage → Edit** (API names: Workers Scripts Write
   and Workers KV Storage Write). Deploying on `workers.dev` needs no zone or DNS
   permissions. Custom domains and routes are outside this deployment.
2. From this directory, run `npx wrangler kv namespace create SHARES` once.
3. Copy `wrangler.toml` to the gitignored `wrangler.deploy.toml`; replace
   `<SHARES_KV_NAMESPACE_ID>` with the returned namespace ID. Wrangler does not
   interpolate KV binding IDs from environment variables or `--var`; those set
   runtime variables. The account ID comes from `CLOUDFLARE_ACCOUNT_ID`.
   Choose unused positive integer rate-limit namespace IDs for this account;
   keep all three distinct. They share counters with other Workers using the same IDs.
4. Run `npx wrangler secret put ADMIN_TOKEN --config wrangler.deploy.toml` and
   enter a random admin secret. Save the same secret to a mode-600 file for the
   daemon; do not store it in this repository or pass it as a CLI argument.
5. Run `npx wrangler deploy --config wrangler.deploy.toml`.
6. Configure `daemon.sharing.publisher` using the returned HTTPS URL and token file.
   Record the deployed URL and token-file path in the operator's configuration and
   ops memory. Leave `daemon.sharing.listen` unset for an outbound-only daemon.

Keep Worker observability off: request URLs contain bearer capabilities. Do not
add URL/token logging, tail sessions, or request-log destinations to this host.
KV propagation can delay revocation by about a minute. Stored expiry metadata is
checked on every request, including during the minimum 60-second KV TTL window.
The Worker never sets cookies or uses the Cache API. Rate limiting is per IP per
Cloudflare location, as provided by the Workers Rate Limiting binding.

Run focused tests from the repository root:
`npx vitest run packages/share-worker/src/index.test.ts --bail=1`.
Root `npm run typecheck`, `npm run lint`, and `npm run format` cover this workspace.

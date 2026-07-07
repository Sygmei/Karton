# Karton (SvelteKit + PostgreSQL)

Web app to analyze a Duel Commander Moxfield deck against MtgTop8 data.

## What it does

1. You paste a Moxfield deck URL.
2. Server-side Playwright always fetches commander and decklist from Moxfield.
3. App finds the matching Duel Commander archetype on MtgTop8.
4. App checks PostgreSQL cache for that commander and finds the most recent cached event date.
5. App crawls MtgTop8 and fetches only decks newer than that cached date.
6. New decks are stored in PostgreSQL.
7. App analyzes your deck against cached MtgTop8 decks and returns:
   - cards to keep (most present in other decks)
   - cards to cut (least present in other decks)
   - cards to add (missing in your deck but common in other decks)

## Stack

- SvelteKit (frontend + backend)
- TypeScript
- PostgreSQL
- Drizzle ORM
- Playwright (Moxfield extraction)
- Cheerio (HTML parsing)

## Environment

Create `.env` with:

```bash
DATABASE_URL_RW=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
DATABASE_URL_RO=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
DATABASE_URL_ADMIN=postgres://postgres:postgres@localhost:5432/mtg_meta_analyzer
OTEL_ENABLED=false
OTEL_SERVICE_NAME=karton-web
OTEL_SERVICE_VERSION=0.1.0
OTEL_DEPLOYMENT_ENVIRONMENT=development
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
OTEL_RESOURCE_ATTRIBUTES=
MYTHIC_TOOLS_API_KEY=
MYTHIC_TOOLS_WEB_KEY=
S3_ENDPOINT_URL=
S3_REGION_NAME=
S3_BUCKET_NAME=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

When `OTEL_ENABLED=true`, the app exports traces to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` if set, otherwise `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`.
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_RESOURCE_ATTRIBUTES` accept comma-separated `key=value` pairs.

## Setup

```bash
npm install
npx playwright install chromium
npm run db:migrate
# optional when schema changes:
# npm run db:generate
```

## Run

```bash
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Build

```bash
npm run check
npm run build
npm run preview
```

## Helm chart

A Helm chart is available at `helm/`.

The chart deploys:

- a two-replica `karton` Deployment using rolling updates with `maxSurge: 0` and `maxUnavailable: 1`
- topology spread constraints so replicas prefer different nodes
- a ClusterIP Service on port `3000`
- an optional Traefik Ingress and HTTPS redirect Middleware
- TLS through cert-manager using the existing `ClusterIssuer` named `letsencrypt-prod`

The chart expects these existing secrets in the target namespace:

- `postgresql-credentials`
- `mythic-tools-credentials`
- `s3-creds`

Create the namespace:

```bash
kubectl create namespace karton
kubectl config set-context --current --namespace=karton
```

Create the database secret once in the target namespace:

```bash
kubectl create secret generic postgresql-credentials \
  --from-literal=connection-string='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer' \
  --from-literal=connection-string-ro='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer' \
  --from-literal=connection-string-admin='postgres://postgres:postgres@postgres:5432/mtg_meta_analyzer'
```

Create the Mythic Tools secret once in the target namespace:

```bash
kubectl create secret generic mythic-tools-credentials \
  --from-literal=api-key='your-api-key' \
  --from-literal=web-key='your-web-key'
```

Create the S3 secret once in the target namespace:

```bash
kubectl create secret generic s3-creds \
  --from-literal=endpoint-url='https://example.invalid' \
  --from-literal=region-name='fra1' \
  --from-literal=bucket-name='your-bucket' \
  --from-literal=access-key-id='your-access-key-id' \
  --from-literal=secret-key='your-secret-key'
```

Install or upgrade the bootstrap chart:

```bash
helm upgrade --install karton-bootstrap ./helm/bootstrap --namespace karton -f ./helm/values.yaml
```

Install or upgrade the application chart:

```bash
helm upgrade --install karton ./helm --namespace karton -f ./helm/values.yaml
```

Use a new immutable `version` tag for each deploy so image updates are deterministic.

## CI setup guide

Create a base64 encoded kubeconfig and store it as the `KUBECONFIG_B64` GitHub secret.

The bootstrap chart creates a namespace-local `ci-helm` service account, binds it to the `karton` namespace, and creates a long-lived token Secret named `ci-helm-token`.

```yaml
ci_access:
  enabled: true
  create_service_account: true
  service_account_name: ci-helm
  service_account_namespace: ""
  create_token_secret: true
  token_secret_name: ci-helm-token
```

After applying the bootstrap chart, generate the value with Nushell:

```bash
nu helm/scripts/generate-kubeconfig-b64.nu --server <SERVER_URL>
```

This prints the base64 encoded kubeconfig that you can paste as the value of the `KUBECONFIG_B64` GitHub secret.
If the token is empty immediately after creating the Secret, wait a few seconds and run the command again.

## Database schema

Migrations are in `migrations/` and are applied by:

```bash
npm run db:migrate
```

Purge MtgTop8 cache:

```bash
# purge all MtgTop8 cached commanders + decks
npm run db:purge:mtgtop8

# purge cache for one commander slug only
npm run db:purge:mtgtop8 -- --commander=phlage-titan-of-fires-fury
```

Main tables:

- `mtgtop8_commanders`
- `mtgtop8_decks`
- `schema_migrations`

## Cache behavior

- Moxfield decks are never cached.
- MtgTop8 decks are cached in PostgreSQL.
- Incremental updates are date-based per commander (newer-than-latest-cached).
- `Refresh MtgTop8 cache` in UI forces a full crawl pass (deduped by `deck_url`).

## Notes

- Moxfield extraction is Playwright-only.
- MtgTop8 and Moxfield markup can change; selectors may need updates over time.
- Existing Python implementation remains in `src/mtg_meta_analyzer` as legacy reference.

# RealClaw — Production Deployment Guide

> This document covers every account, credential, and step required to go from zero to a running RealClaw production environment.

---

## Part 1 — Accounts & Services to Create

Create these accounts before touching any config. Each section lists exactly what credential to capture and where it goes.

---

### 1.1 Infrastructure Accounts

#### GitHub Container Registry (GHCR)
- Already attached to your GitHub account (`gmickelsen3`)
- Enable "packages" in your GitHub org settings if not already visible
- No extra setup needed — the CI pipeline logs in with `GITHUB_TOKEN` automatically

#### Kubernetes Cluster
Choose one:
- **AWS EKS**: `eksctl create cluster --name realclaw --region us-west-2 --nodegroup-name workers --node-type t3.xlarge --nodes 3`
- **GKE**: `gcloud container clusters create realclaw --machine-type n2-standard-4 --num-nodes 3 --region us-west-2`
- **DigitalOcean Kubernetes**: Create via dashboard, 3×`s-4vcpu-8gb` nodes
- After creation, export the kubeconfig and base64-encode it for CI:
  ```bash
  kubectl config view --raw | base64 -w 0
  ```
  → This value becomes `KUBE_CONFIG_PRODUCTION` and `KUBE_CONFIG_STAGING` in GitHub Secrets

#### cert-manager (for TLS)
Install into cluster after it's running:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: YOUR_EMAIL@realclaw.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

#### nginx Ingress Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx --create-namespace
```
After install, get the load balancer IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```
→ Point `api.realclaw.com` DNS A record to this IP

---

### 1.2 Managed Database Accounts (Production)

Do not use the in-cluster Postgres/Redis for production. Use managed services.

#### PostgreSQL — AWS RDS or Supabase
**Option A — AWS RDS (recommended):**
- Create RDS PostgreSQL 16 instance, `db.t3.medium` minimum
- Database name: `realclaw`, username: `realclaw`
- Enable automated backups (7-day retention)
- VPC security group: allow ingress on port 5432 from your K8s node group security group only
- Capture: `DATABASE_URL=postgresql://realclaw:<PASSWORD>@<RDS_ENDPOINT>:5432/realclaw`

**Option B — Supabase (easier):**
- Create project at supabase.com
- Capture the "Connection string" from Settings → Database → URI
- `DATABASE_URL=postgresql://postgres:<PASSWORD>@<PROJECT>.supabase.co:5432/postgres`

#### Redis — AWS ElastiCache or Upstash
**Option A — AWS ElastiCache:**
- Create Redis 7 cluster, `cache.t3.micro` minimum (1 node for staging, 3 for production)
- No persistence needed (used for rate limits, locks, cancellation — all recoverable)
- Security group: allow port 6379 from K8s node group only
- Capture: `REDIS_URL=redis://<ELASTICACHE_ENDPOINT>:6379`

**Option B — Upstash (serverless, easiest):**
- Create Redis database at upstash.com
- Capture the "Redis URL" (format: `rediss://default:<TOKEN>@<ENDPOINT>.upstash.io:6379`)

---

### 1.3 LLM Provider Accounts

At minimum you need **Manifest** + **Anthropic**. Others are optional.

#### Manifest (Primary LLM Router) — Required
- Create account at manifest.build
- Create a new "Agent" in the dashboard and configure your upstream providers inside Manifest's UI
- Copy the API key (format: `mnfst_…`)
- The Manifest service runs as a Docker sidecar (`manifest:3001`) in local dev; for K8s you can run it as a second Deployment in the `realclaw` namespace or use your hosted Manifest URL
- Captures:
  - `CLAW_MANIFEST_API_KEY=mnfst_...`
  - `CLAW_MANIFEST_ENDPOINT=http://manifest:3001` (Docker) or your hosted Manifest URL
  - `MANIFEST_AUTH_SECRET=<openssl rand -hex 32>`

#### Anthropic (Fallback provider) — Required
- Create account at console.anthropic.com
- Create an API key under API Keys
- Capture: `CLAW_ANTHROPIC_API_KEY=sk-ant-...`

#### OpenAI (Optional)
- Create account at platform.openai.com → API Keys
- Capture: `CLAW_OPENAI_API_KEY=sk-...`

#### Google Gemini (Optional)
- Go to aistudio.google.com → Get API key
- Capture: `CLAW_GOOGLE_API_KEY=AIza...`

#### OpenRouter (Optional — access to many models via one key)
- Create account at openrouter.ai
- Capture: `CLAW_OPENROUTER_API_KEY=sk-or-...`

---

### 1.4 Google Cloud — OAuth + Calendar + Gmail

One Google Cloud project covers Gmail, Calendar, and Sign in with Google.

1. Go to console.cloud.google.com → New Project → name it "RealClaw"
2. **Enable APIs:**
   - Gmail API
   - Google Calendar API
   - Google People API (for contact sync)
   - Identity Toolkit API (for Sign in with Google)
3. **OAuth consent screen:**
   - User type: External (or Internal if G-Suite org)
   - App name: RealClaw
   - Support email + developer contact: your email
   - Scopes to add:
     - `https://mail.google.com/`
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/contacts.readonly`
   - Add test users during development
4. **OAuth 2.0 Credentials → Create OAuth client ID:**
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/oauth/gmail/callback` (dev)
     - `https://api.realclaw.com/oauth/gmail/callback` (prod)
     - `https://api.realclaw.com/oauth/google_calendar/callback` (prod)
   - Capture:
     - `CLAW_GMAIL_CLIENT_ID=...apps.googleusercontent.com`
     - `CLAW_GMAIL_CLIENT_SECRET=GOCSPX-...`
5. **Sign in with Google (mobile app):**
   - Create a second OAuth client ID, type: iOS
   - Bundle ID: `com.realclaw.app`
   - Capture the iOS Client ID
   - Set `GOOGLE_CLIENT_ID=...apps.googleusercontent.com` (the iOS one)
   - In `apps/mobile/app.json` under `@react-native-google-signin/google-signin`, set `iosUrlScheme` to `com.googleusercontent.apps.<REVERSED_CLIENT_ID>`

---

### 1.5 Apple Developer — Sign in with Apple + Push Notifications

1. Go to developer.apple.com → Account
2. **Sign in with Apple:**
   - Identifiers → App IDs → Register new: `com.realclaw.app`
   - Enable capability: Sign In with Apple
   - Services IDs → Register new: `com.realclaw.app.signin`
   - Under the Service ID: configure "Sign in with Apple" → Add domain `app.realclaw.com` and return URL `https://api.realclaw.com/v1/auth/apple`
   - Capture: `APPLE_CLIENT_ID=com.realclaw.app`
3. **Push Notifications (APNs):**
   - Keys → Create new key → Enable Apple Push Notifications service (APNs)
   - Download the `.p8` file — this cannot be re-downloaded
   - Capture: Key ID, Team ID, and the `.p8` file contents
   - Upload to Expo: `eas credentials --platform ios` (see § 1.6)
4. **Provisioning:**
   - EAS handles certificates and profiles automatically via `eas credentials`
   - Run `eas credentials --platform ios` and follow the interactive prompts

---

### 1.6 Expo Account (EAS)

1. Create account at expo.dev
2. Create a new project named `realclaw`
3. Install EAS CLI: `npm install -g eas-cli`
4. Login: `eas login`
5. Initialize project in the mobile app: `cd apps/mobile && eas init`
6. **APNs key upload:** `eas credentials --platform ios` → follow prompts to upload the `.p8` file from § 1.5
7. **FCM key upload (Android push):**
   - Go to Firebase console → create project → add Android app with package `com.realclaw.app`
   - Download `google-services.json` → place at `apps/mobile/google-services.json`
   - `eas credentials --platform android` → upload FCM server key
8. Generate an Expo token for CI:
   - expo.dev → Account Settings → Access Tokens → Create
   - Capture: `EXPO_TOKEN=expo_...`
9. Fill in the submit section of `apps/mobile/eas.json`:
   - `appleId`: your Apple ID email
   - `ascAppId`: App Store Connect app ID (create the app record in App Store Connect first)
   - `appleTeamId`: your 10-character team ID from developer.apple.com
   - `serviceAccountKeyPath`: `./google-services-key.json`

---

### 1.7 Google Play (Android)

1. Create developer account at play.google.com/console ($25 one-time)
2. Create new application: "RealClaw", package `com.realclaw.app`
3. Create a Service Account for CI:
   - Google Play Console → Setup → API access → Link to Google Cloud project
   - In Google Cloud: IAM → Service Accounts → Create → name it `eas-submit`
   - Grant role: "Service Account User"
   - In Google Play Console: grant this service account "Release manager" permission
   - Create and download a JSON key for the service account
   - Save as `apps/mobile/google-services-key.json` (add to `.gitignore` — never commit)

---

### 1.8 HubSpot (CRM Integration)

1. Create developer account at developers.hubspot.com
2. Create a new app → OAuth scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`
3. Set redirect URI: `https://api.realclaw.com/oauth/hubspot/callback`
4. The `CLAW_HUBSPOT_ACCESS_TOKEN` and `CLAW_HUBSPOT_REFRESH_TOKEN` are obtained after a user completes the in-app OAuth flow — they are stored automatically in the vault, not set as env vars

---

### 1.9 Twilio (SMS)

1. Create account at twilio.com
2. Buy a phone number (US local ~$1/month)
3. Capture:
   - `CLAW_TWILIO_ACCOUNT_SID=AC...`
   - `CLAW_TWILIO_AUTH_TOKEN=...`
   - `CLAW_TWILIO_PHONE_NUMBER=+1...`

---

### 1.10 RentCast (MLS Data)

1. Create account at rentcast.io
2. Choose a plan (Free: 50 calls/month; Starter $19/month: 1,000 calls)
3. API Keys section → create key
4. Capture:
   - `CLAW_RENTCAST_API_KEY=...`
   - `CLAW_PRIMARY_ZIP=<default market ZIP code>`

---

### 1.11 DocuSign (Document Signing) — Optional

1. Create developer account at developers.docusign.com
2. Create an app → Integration key
3. Add RSA keypair for JWT Grant (recommended for server-to-server)
4. Capture:
   - `CLAW_DOCUSIGN_INTEGRATION_KEY=...`
   - `CLAW_DOCUSIGN_SECRET_KEY=...`
   - `CLAW_DOCUSIGN_ACCOUNT_ID=...`

---

### 1.12 Buffer (Social Media Scheduling) — Optional

1. Create account at buffer.com → developers.buffer.com → Create app
2. OAuth redirect: `https://api.realclaw.com/oauth/buffer/callback`
3. The access token is obtained via user OAuth flow and stored in the vault — not a static env var

---

### 1.13 Monitoring — Slack Webhook

1. Go to api.slack.com → Create App → Incoming Webhooks
2. Add to your workspace, select or create `#claw-alerts` channel
3. Capture: `CLAW_ADMIN_SLACK_WEBHOOK=https://hooks.slack.com/services/...`

---

## Part 2 — Generate Secrets

Run these commands locally. **Store outputs in a password manager, not in any file.**

```bash
# JWT signing secret (access tokens)
openssl rand -hex 32
# → JWT_SECRET

# Vault master key (encrypts all OAuth tokens at rest with AES-256-GCM)
openssl rand -hex 32
# → CLAW_VAULT_MASTER_KEY

# Manifest auth secret
openssl rand -hex 32
# → MANIFEST_AUTH_SECRET

# PostgreSQL password
openssl rand -base64 24
# → POSTGRES_PASSWORD
```

Use **different values** for staging vs production. Never reuse the vault master key between environments.

---

## Part 3 — GitHub Repository Secrets

Go to: github.com/gmickelsen3/RealClaw → Settings → Secrets and variables → Actions

Create Environments first: `staging` and `production`. Then add the secrets below.

### Repository-Level Secrets (available in all workflows)
| Secret Name | Value Source |
|---|---|
| `EXPO_TOKEN` | § 1.6 |
| `ANTHROPIC_API_KEY` | § 1.3 |

### Staging Environment Secrets
| Secret Name | Value Source |
|---|---|
| `KUBE_CONFIG_STAGING` | base64-encoded staging kubeconfig |
| `JWT_SECRET_STAGING` | Part 2 — generate separately |
| `DATABASE_URL_STAGING` | Staging DB connection string |
| `REDIS_URL_STAGING` | Staging Redis URL |
| `VAULT_MASTER_KEY_STAGING` | Part 2 — generate separately |

### Production Environment Secrets
| Secret Name | Value Source |
|---|---|
| `KUBE_CONFIG_PRODUCTION` | base64-encoded production kubeconfig |
| `JWT_SECRET_PRODUCTION` | Part 2 — generate separately |
| `DATABASE_URL_PRODUCTION` | Production RDS/Supabase connection string |
| `REDIS_URL_PRODUCTION` | Production ElastiCache/Upstash URL |
| `VAULT_MASTER_KEY_PRODUCTION` | Part 2 — generate separately |
| `POSTGRES_PASSWORD_PRODUCTION` | Part 2 — generate separately |

---

## Part 4 — Local Development Setup

```bash
# Clone and enter repo
git clone https://github.com/gmickelsen3/RealClaw.git && cd RealClaw

# Use correct Node version
nvm install 22 && nvm use 22

# Install all workspace dependencies
npm install

# Copy env template
cp .env.example .env
# Fill in at minimum:
#   CLAW_ANTHROPIC_API_KEY or CLAW_MANIFEST_API_KEY
#   CLAW_VAULT_MASTER_KEY   (openssl rand -hex 32)
#   JWT_SECRET              (openssl rand -hex 32)
#   DATABASE_URL=postgresql://claw:claw@localhost:5432/realclaw
#   REDIS_URL=redis://localhost:6379

# Start infrastructure (Postgres, Redis, Manifest, Browserless)
docker compose up -d

# Run migrations
sleep 5
node node_modules/.bin/tsx src/db/migrate.ts

# Start backend in watch mode
npm run dev
# → Gateway listening on :18789

# Verify
curl http://localhost:18789/health/live   # → {"ok":true}
curl http://localhost:18789/health/ready  # → {"ready":true,...}

# Run full test suite
node node_modules/.bin/vitest run
# → 416 tests passing

# Mobile (separate terminal)
cd apps/mobile && npm install && npx expo start
```

> **WSL2 note:** If `node` or `npx` resolve to a Windows binary, prefix commands with the full nvm path:
> `/home/grant/.nvm/versions/node/v22.12.0/bin/node node_modules/.bin/vitest run`

---

## Part 5 — First Backend Deployment (Staging)

### 5.1 Build and push image (first time only — CI handles this after)

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u gmickelsen3 --password-stdin
docker build -t ghcr.io/gmickelsen3/realclaw-backend:v0.1.0 .
docker push ghcr.io/gmickelsen3/realclaw-backend:v0.1.0
```

### 5.2 Bootstrap the cluster

```bash
export KUBECONFIG=~/.kube/staging-config

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# Staging only: in-cluster Redis and Postgres
kubectl apply -f k8s/redis/
kubectl apply -f k8s/postgres/
kubectl rollout status deployment/redis -n realclaw
kubectl rollout status deployment/postgres -n realclaw
```

### 5.3 Inject secrets

```bash
kubectl create secret generic realclaw-secrets --namespace=realclaw \
  --from-literal=JWT_SECRET=<your-staging-jwt-secret> \
  --from-literal=DATABASE_URL=postgresql://realclaw:<pass>@postgres.realclaw.svc.cluster.local:5432/realclaw \
  --from-literal=REDIS_URL=redis://redis.realclaw.svc.cluster.local:6379 \
  --from-literal=CLAW_VAULT_MASTER_KEY=<your-staging-vault-key> \
  --from-literal=ANTHROPIC_API_KEY=<your-anthropic-key> \
  --from-literal=CLAW_MANIFEST_API_KEY=<your-manifest-key> \
  --from-literal=APPLE_CLIENT_ID=com.realclaw.app \
  --from-literal=GOOGLE_CLIENT_ID=<your-google-client-id> \
  --from-literal=POSTGRES_PASSWORD=<your-db-password> \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 5.4 Deploy

```bash
IMAGE_TAG=v0.1.0
sed "s|\${IMAGE_TAG}|${IMAGE_TAG}|g" k8s/deployment-gateway.yaml | kubectl apply -f -
kubectl apply -f k8s/service-gateway.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa-gateway.yaml
kubectl apply -f k8s/pdb-gateway.yaml

# Watch init container (migrations) then main container
kubectl rollout status deployment/gateway --namespace=realclaw --timeout=300s
```

### 5.5 Verify

```bash
kubectl get pods -n realclaw
curl https://staging-api.realclaw.com/health/live    # → {"ok":true}
curl https://staging-api.realclaw.com/health/ready   # → {"ready":true,...}
```

---

## Part 6 — CI/CD Pipeline Activation

After manual staging deploy works:

1. Confirm all GitHub Secrets from Part 3 are set
2. Push any commit to `main` → `backend-ci.yml` triggers:
   - Spins up ephemeral Postgres + Redis service containers
   - Runs `tsc --noEmit` (type check) + all 416 tests + 80% coverage gate
   - Builds and pushes Docker image to GHCR with `sha-<commit>` tag
   - Deploys to staging and runs smoke tests
3. All future `main` merges deploy to staging automatically

---

## Part 7 — Production Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

`release.yml` triggers:
1. Deploys tagged image to production cluster (10-min timeout for DB migrations)
2. Verifies `/health/live` and `/health/ready` on `api.realclaw.com`
3. Submits iOS binary to App Store Connect via EAS
4. Submits Android bundle to Google Play via EAS (parallel with iOS)

**Before tagging your first `v1.0.0`:**
- Replace the `YOUR_*` placeholder values in `apps/mobile/eas.json` submit section with real Apple and Google credentials
- Build production binaries first (they must exist before submit can run):
  ```bash
  cd apps/mobile
  eas build --platform all --profile production
  ```
- Ensure the app record exists in App Store Connect and Google Play Console

---

## Part 8 — Mobile App Release

### First build

```bash
cd apps/mobile

# Build production binaries (runs on Expo's cloud infrastructure)
eas build --platform ios --profile production      # ~20-30 min
eas build --platform android --profile production  # ~15-20 min

# Check build status
eas build:list
```

### Submit to stores

```bash
# iOS → App Store Connect (appears in TestFlight first)
eas submit --platform ios --profile production

# Android → Google Play Internal Test track
eas submit --platform android --profile production
```

### OTA updates (after App Store approval)

For JS/asset-only bug fixes — no native code changes:

```bash
cd apps/mobile

# Export bundle and run safety check
npx expo export --platform ios --output-dir /tmp/bundle
node ../../scripts/check-ota-safety.mjs /tmp/bundle
# Must exit 0 before proceeding

# Add entry to CHANGELOG_OTA.md, then publish
eas update --channel production --message "Fix: <description>"
```

The OTA safety script blocks any bundle containing new `NativeModules.*` calls, permission strings, `eval()`, or unapproved integration IDs. If it exits 1, route to full App Store review instead.

---

## Part 9 — Environment Variable Reference

### Core Gateway
| Variable | Required | Description | Example |
|---|---|---|---|
| `NODE_ENV` | Yes | Runtime mode | `production` |
| `OPENCLAW_GATEWAY_PORT` | No | HTTP listen port | `18789` |
| `OPENCLAW_LOG_LEVEL` | No | Log verbosity | `info` |
| `CLAW_MEMORY_PATH` | No | Memory file root | `/opt/claw/memory` |
| `JWT_SECRET` | Yes | Access token signing key | 32-byte hex |
| `JWT_ISSUER` | No | JWT iss claim | `realclaw` |
| `CLAW_VAULT_MASTER_KEY` | Yes | AES-256-GCM key for credential encryption | 32-byte hex |
| `DATABASE_URL` | Yes | PostgreSQL connection | `postgresql://...` |
| `REDIS_URL` | No | Redis — enables distributed locks, rate limits, cancellation | `redis://...` |

### Authentication
| Variable | Required | Description |
|---|---|---|
| `APPLE_CLIENT_ID` | Yes (mobile) | iOS bundle ID for Sign in with Apple verification |
| `GOOGLE_CLIENT_ID` | Yes (mobile) | Google OAuth client ID (iOS type) for token verification |

### LLM Providers
| Variable | Required | Description |
|---|---|---|
| `CLAW_MANIFEST_API_KEY` | Recommended | Manifest smart router key (`mnfst_...`) |
| `CLAW_MANIFEST_ENDPOINT` | If Manifest | Base URL — `http://manifest:3001` (Docker) |
| `MANIFEST_AUTH_SECRET` | If Manifest | 32-byte hex |
| `CLAW_ANTHROPIC_API_KEY` | Yes (fallback) | Claude API key |
| `CLAW_OPENAI_API_KEY` | No | OpenAI key |
| `CLAW_GOOGLE_API_KEY` | No | Gemini key |
| `CLAW_OPENROUTER_API_KEY` | No | OpenRouter key |
| `CLAW_OLLAMA_HOST` / `CLAW_OLLAMA_PORT` | No | Local Ollama host/port |

### Integrations
| Variable | Required | Description |
|---|---|---|
| `CLAW_GMAIL_CLIENT_ID` | For Gmail | Google OAuth client ID (web application type) |
| `CLAW_GMAIL_CLIENT_SECRET` | For Gmail | Google OAuth client secret |
| `CLAW_GMAIL_REDIRECT_URI` | For Gmail | `https://api.realclaw.com/oauth/gmail/callback` |
| `CLAW_TWILIO_ACCOUNT_SID` | For SMS | Twilio account SID |
| `CLAW_TWILIO_AUTH_TOKEN` | For SMS | Twilio auth token |
| `CLAW_TWILIO_PHONE_NUMBER` | For SMS | E.164 format phone number |
| `CLAW_RENTCAST_API_KEY` | For MLS | RentCast API key |
| `CLAW_PRIMARY_ZIP` | For MLS | Default market ZIP code |
| `CLAW_DOCUSIGN_INTEGRATION_KEY` | Optional | DocuSign integration key |
| `CLAW_DOCUSIGN_SECRET_KEY` | Optional | DocuSign secret |
| `CLAW_DOCUSIGN_ACCOUNT_ID` | Optional | DocuSign account ID |

> **Note:** HubSpot, Buffer, Canva, and DocuSign tokens are obtained through in-app OAuth flows and stored in the vault automatically. They are **not** set as env vars — the vault encrypts them at rest using `CLAW_VAULT_MASTER_KEY`.

### Monitoring
| Variable | Required | Description |
|---|---|---|
| `CLAW_ADMIN_SLACK_WEBHOOK` | No | Slack incoming webhook URL for system alerts |
| `CLAW_ADMIN_ALERT_CHANNEL` | No | Slack channel name (e.g. `#claw-alerts`) |

---

## Part 10 — Post-Deployment Checklist

### Backend
- [ ] `/health/live` returns 200 with uptime
- [ ] `/health/ready` returns 200 with all checks green
- [ ] Migrations ran successfully (check init container logs: `kubectl logs -n realclaw deployment/gateway -c migrate`)
- [ ] WebSocket connections work: `wscat -c "wss://api.realclaw.com/ws?token=<dev-jwt>"`
- [ ] `POST /v1/messages` returns 202 with `{messageId, correlationId}`
- [ ] WS receives `AGENT_TYPING` → `TOKEN_STREAM` → `TASK_COMPLETE` sequence
- [ ] No raw secrets in any committed file
- [ ] HPA shows 3 replicas: `kubectl get hpa -n realclaw`
- [ ] PDB active: `kubectl get pdb -n realclaw`

### Mobile
- [ ] Sign in with Apple works on physical device
- [ ] Sign in with Google works on physical device
- [ ] Biometric gate fires before sending an approval
- [ ] Push notification delivered to lock screen for approval request
- [ ] Offline queue drains after reconnect (airplane mode test)
- [ ] `PrivacyInfo.xcprivacy` confirmed in archive (Xcode → Product → Archive → Validate App → Privacy manifest)

### App Store
- [ ] Privacy Nutrition Label filled in App Store Connect (matches `PrivacyInfo.xcprivacy`)
- [ ] App Review notes written: "B2B professional tool for licensed real estate agents. Subscription managed on realclaw.com."
- [ ] No pricing, upgrade CTAs, or subscription links in the binary
- [ ] All AI-generated content shows "Draft (AI)" label in UI
- [ ] Background modes declared in `app.json`: `fetch`, `remote-notification`, `processing`

---

## Part 11 — Troubleshooting

### Gateway pod stuck in Init state
The DB migration init container failed.
```bash
kubectl logs -n realclaw deployment/gateway -c migrate
```
Common causes: `DATABASE_URL` secret missing, wrong format, or DB not yet reachable.

### `/health/ready` returning 503
```bash
curl https://api.realclaw.com/health/ready
# Inspect: {"ready":false,"checks":{"postgres":false,"redis":true,"llm":true}}
```
Fix the failing dependency — the pod becomes ready automatically once all checks pass.

### WebSocket connections timing out behind ingress
The ingress must carry the long-timeout and upgrade annotations. Verify:
```bash
kubectl get ingress gateway -n realclaw -o yaml | grep -E "timeout|upgrade"
```
Expected: `proxy-read-timeout: "3600"`, `proxy-send-timeout: "3600"`, and the `Upgrade`/`Connection` configuration-snippet.

### OTA safety check blocking a safe update
The bundle contains a pattern the script doesn't recognize as safe. If the change is genuinely OTA-safe, update the `DISALLOWED` patterns in `scripts/check-ota-safety.mjs`. If a new integration was added, add its ID to the approved allowlist pattern only after completing a full App Store review for it.

### Push notifications not arriving
1. Confirm push token registered: look for the device in `tenant_device_tokens` table
2. Check APNs key hasn't expired — Apple `.p8` keys do not expire, but if you rotated it without re-uploading to Expo the sends will silently fail. Run `eas credentials --platform ios` to verify.
3. Verify `mutableContent: true` is set in the payload — the `UNNotificationServiceExtension` must be present in the archive to enrich notifications before display.

### Rate limiter not isolating tenants
Confirm `REDIS_URL` is set. Without Redis, the rate limiter is in-memory per process — multiple replicas have independent windows. With Redis, all replicas share one sliding window per `(tenantId, integrationId)` key.

# RealClaw — Developer Notes

## Local Development Workflow

### First-time setup
```bash
# 1. Start infrastructure (no gateway — we run that locally)
npm run dev:infra

# 2. Run DB migrations
npm run migrate

# 3. Fix directory ownership if needed (Docker creates these as root)
sudo chown -R $USER ./credentials ./memory
mkdir -p credentials memory

# 4. Start backend in watch mode
npm run dev
```

### Every subsequent session
```bash
npm run dev:infra   # starts postgres, redis, manifest, browser (not the dockerized gateway)
npm run dev         # runs src/index.ts locally with hot reload
```

`npm run dev:infra` intentionally excludes the `gateway` Docker service — running the gateway in Docker and locally at the same time causes `EADDRINUSE` on port 18789.

### Running tests
```bash
# Backend (vitest)
npm test

# Mobile (jest) — from repo root
npm test --workspace=apps/mobile -- --ci --passWithNoTests
# or from apps/mobile directly:
cd apps/mobile && npm test -- --ci --passWithNoTests
```

### Mobile app on physical phone
The mobile app uses `EXPO_PUBLIC_API_HOST` to reach the backend. Set it in `apps/mobile/.env`:
```
EXPO_PUBLIC_API_HOST=192.168.x.x   # your Windows LAN IP (ipconfig → WiFi IPv4)
```

WSL2 port-forward (run once in PowerShell as Admin after each Windows reboot):
```powershell
# Get WSL2 IP (run in WSL2 terminal first): hostname -I
netsh interface portproxy add v4tov4 listenport=18789 listenaddress=0.0.0.0 connectport=18789 connectaddress=<WSL2_IP>
netsh advfirewall firewall add rule name="RealClaw Dev Backend" protocol=TCP dir=in localport=18789 action=allow
```

Then start the mobile app:
```bash
cd apps/mobile && npx expo start --tunnel -c
```

### WSL2 path prefix
If `node` or `npx` resolve to Windows binaries, prefix commands with the nvm path:
```bash
PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH" npm test
```

### DB migrations
```bash
npm run migrate
```

Migrations live in `src/db/migrations/`. After adding a new migration file, run `migrate` before starting the server.

## Known Issues / Workarounds

- **Manifest unavailable**: The Manifest LLM router requires first-time setup at http://localhost:3001 (create account, add provider keys, create an agent, copy `mnfst_…` key to `.env`). Until then, all LLM calls fall through to Anthropic directly — fully functional.
- **`credentials/` and `memory/` owned by root**: Docker creates these directories on first `docker compose up`. Fix with `sudo chown -R $USER ./credentials ./memory`.
- **Expo tunnel "session closed"**: Kill stale Metro process first: `kill $(lsof -ti:8081) 2>/dev/null && npx expo start --tunnel -c`

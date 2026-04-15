# RealClaw Mobile E2E Tests (Maestro)

## Prerequisites

```bash
# Install Maestro CLI
curl -Ls "https://get.maestro.mobile.dev" | bash

# Verify installation
maestro --version  # should be 1.38+
```

## Running Flows

```bash
cd apps/mobile

# Run a single flow
maestro test e2e/sign-in.yaml

# Run all flows sequentially
maestro test e2e/

# Run with a specific device
maestro --device <UDID> test e2e/send-message.yaml
```

## Test Environment Setup

1. Start the backend: `npm run dev` (from repo root)
2. Start Expo in simulator: `npm run ios`
3. Ensure the simulator has Biometric auth enrolled (for approve-email flow)

## Biometric Gate in Tests

`approve-email.yaml` requires biometric authentication. The app reads the
`TEST_BIOMETRIC_BYPASS` environment variable at startup — when set to `"true"`,
`ApprovalCard.tsx` skips the `LocalAuthentication.authenticateAsync()` call and
proceeds directly to the API call.

**Never set `TEST_BIOMETRIC_BYPASS=true` in production builds.** It is stripped
by the EAS build pipeline for `production` and `staging` profiles.

## Flow Descriptions

| File | What it tests |
|------|---------------|
| `sign-in.yaml` | Cold launch → Sign in with Apple → lands on Chat |
| `send-message.yaml` | Type message → send → streaming response appears |
| `approve-email.yaml` | Agent drafts email → approval card → biometric → submitted |
| `offline-queue.yaml` | Send while offline → queue shows → reconnect → message delivered |

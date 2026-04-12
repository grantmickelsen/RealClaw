import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        // Gateway bootstrap — not unit-testable
        'src/index.ts',
        // Agent implementations — require full LLM + coordinator integration
        'src/agents/**/*.ts',
        // External API integrations — require live OAuth / HTTP stubs
        'src/integrations/**/*.ts',
        // Coordinator orchestration — integration-level only
        'src/coordinator/coordinator.ts',
        'src/coordinator/dispatcher.ts',
        'src/coordinator/router.ts',
        // OAuth flow — requires browser redirect + token exchange
        'src/credentials/oauth-handler.ts',
        // LLM provider factory — wires env vars to concrete classes
        'src/llm/factory.ts',
        // Providers without dedicated test suites yet
        'src/llm/providers/google.ts',
        'src/llm/providers/openrouter.ts',
        // File-system middleware without dedicated test suites yet
        'src/middleware/audit-logger.ts',
        'src/middleware/cost-tracker.ts',
        // Zod schema definitions (no executable logic)
        'src/memory/memory-schema.ts',
        // CLI wrapper — requires whisper binary
        'src/utils/whisper.ts',
        // Pure type files (no executable code)
        'src/types/**/*.ts',
        // Interactive CLI wizard — requires a real terminal
        'src/setup/cli.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 70,
      },
    },
  },
});

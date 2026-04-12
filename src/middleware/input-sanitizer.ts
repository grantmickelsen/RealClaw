export interface SanitizeResult {
  sanitizedText: string;
  flagged: boolean;
  flagReason?: string;
}

// Common prompt injection patterns
const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
    reason: 'Ignore-previous-instructions injection',
  },
  {
    pattern: /\[SYSTEM\]|\<\/?system\>|<\/?SYSTEM>/g,
    reason: 'System prompt override attempt',
  },
  {
    pattern: /you\s+are\s+now\s+(a\s+)?(different|new|another)\s+(ai|assistant|model|bot)/gi,
    reason: 'Role-play persona override',
  },
  {
    pattern: /act\s+as\s+if\s+you\s+have\s+no\s+restrictions?/gi,
    reason: 'Restriction removal attempt',
  },
  {
    pattern: /pretend\s+you\s+are\s+(?:not|an?\s+unrestricted)/gi,
    reason: 'Pretend-override attempt',
  },
  {
    pattern: /forget\s+your\s+(previous\s+)?(instructions?|training|rules?|guidelines?)/gi,
    reason: 'Forget-instructions injection',
  },
  {
    pattern: /\bDAN\b|\bJailbreak\b/g,
    reason: 'Known jailbreak keyword',
  },
  {
    pattern: /override\s+(safety|content)\s+(filter|policy|guidelines?)/gi,
    reason: 'Safety filter override attempt',
  },
  {
    pattern: /\bprompt\s+injection\b/gi,
    reason: 'Explicit prompt injection reference',
  },
];

// Characters that should be stripped for safety
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitize(text: string): SanitizeResult {
  // Strip control characters
  let sanitizedText = text.replace(CONTROL_CHAR_PATTERN, '');

  // Normalize excessive whitespace but preserve newlines
  sanitizedText = sanitizedText.replace(/[ \t]{3,}/g, '  ');

  // Truncate to reasonable max length (prevent token exhaustion)
  const MAX_LENGTH = 32_000;
  if (sanitizedText.length > MAX_LENGTH) {
    sanitizedText = sanitizedText.slice(0, MAX_LENGTH) + '\n[TRUNCATED]';
  }

  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(sanitizedText)) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      // Redact the matched portion rather than blocking entirely
      sanitizedText = sanitizedText.replace(pattern, '[REDACTED]');

      return {
        sanitizedText,
        flagged: true,
        flagReason: reason,
      };
    }
    // Reset lastIndex after test
    pattern.lastIndex = 0;
  }

  return { sanitizedText, flagged: false };
}

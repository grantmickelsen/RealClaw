export interface FairHousingRule {
  id: string;
  description: string;
  pattern: RegExp;
  severity: 'warning' | 'error';
  suggestion: string;
}

export interface ComplianceScanResult {
  passed: boolean;
  flags: {
    ruleId: string;
    text: string;
    severity: 'warning' | 'error';
    suggestion: string;
  }[];
}

// Built-in fair housing rules
// Config from fair-housing-rules.json extends these
export const BUILT_IN_FAIR_HOUSING_RULES: FairHousingRule[] = [
  {
    id: 'fh-001',
    description: 'Race and national origin',
    pattern: /\b(whites?\s+only|no\s+(minorities|blacks?|hispanics?|asians?|latinos?)|preferred\s+neighborhood)\b/gi,
    severity: 'error',
    suggestion: 'Remove discriminatory language. Focus on property features, not demographic preferences.',
  },
  {
    id: 'fh-002',
    description: 'Family status',
    pattern: /\b(no\s+kids?|adults?\s+only|childless|no\s+children|childless\s+community|mature\s+adults?\s+only)\b/gi,
    severity: 'error',
    suggestion: 'Remove family status discrimination. You may describe senior housing only if it qualifies under HUD exemptions.',
  },
  {
    id: 'fh-003',
    description: 'Religion',
    pattern: /\b(christian|jewish|muslim|catholic|protestant)\s+(neighborhood|community|area|preferred)\b/gi,
    severity: 'error',
    suggestion: 'Remove religious preference language.',
  },
  {
    id: 'fh-004',
    description: 'Disability',
    pattern: /\b(able-bodied|healthy|no\s+disabled|non-disabled)\b/gi,
    severity: 'error',
    suggestion: 'Remove ableist language. Describe accessibility features positively.',
  },
  {
    id: 'fh-005',
    description: 'School district as demographic proxy',
    pattern: /\b(great\s+schools?|top\s+schools?|exclusive\s+school\s+district)\b/gi,
    severity: 'warning',
    suggestion: 'School district references can be fair housing violations in some jurisdictions. Consider saying "near [school name]" instead.',
  },
  {
    id: 'fh-006',
    description: 'Neighborhood demographic description',
    pattern: /\b(safe\s+neighborhood|quiet\s+neighborhood|good\s+neighborhood|nice\s+area|good\s+area)\b/gi,
    severity: 'warning',
    suggestion: 'Subjective neighborhood quality terms can be interpreted as coded discriminatory language. Describe specific features instead.',
  },
  {
    id: 'fh-007',
    description: 'Walk Score / demographic proxies',
    pattern: /\b(ethnic|cultural\s+diversity|diverse\s+(neighborhood|community))\b/gi,
    severity: 'warning',
    suggestion: 'Describing neighborhood demographics can violate fair housing. Focus on amenities and property features.',
  },
];

export function scanContent(
  text: string,
  additionalRules: FairHousingRule[] = [],
): ComplianceScanResult {
  const allRules = [...BUILT_IN_FAIR_HOUSING_RULES, ...additionalRules];
  const flags: ComplianceScanResult['flags'] = [];

  for (const rule of allRules) {
    if (rule.pattern.test(text)) {
      rule.pattern.lastIndex = 0; // Reset global regex
      flags.push({
        ruleId: rule.id,
        text: rule.description,
        severity: rule.severity,
        suggestion: rule.suggestion,
      });
    }
    rule.pattern.lastIndex = 0;
  }

  return {
    passed: !flags.some(f => f.severity === 'error'),
    flags,
  };
}

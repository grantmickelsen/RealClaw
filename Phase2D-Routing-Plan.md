# Phase 2D: Smart Routing Implementation Plan

## Information Gathered

**Current State** (from read_files):
- **router.ts**: `matchRules()` iterates `Object.entries(singleDispatch)` unsorted (short prefixes match first, e.g., 'email' before 'draft_email').
  - Rule match → RoutingDecision (intent, confidence 0.95, mode/targets).
  - LLM fallback for no rule (ModelTier.FAST, threshold 0.8).
  - No length sort.
- **dispatcher.ts**: `dispatchChain()` uses `initialRequest.taskType` for all agents (no override).
  - Parallel uses `Promise.allSettled` (good).
  - Single/chain timeouts via `withTimeout`.
- **agents.json**: Basic rules:
  - singleDispatch: ~26 (schedule_, draft_email, who_is, pull_comps, etc.).
  - multiDispatch: 4 (new_listing, prep_for_meeting, follow_up_with, showing_notes).
  - chainDispatch: 1 (find_and_send without chainTaskTypes).

**Intentions** (fizzy-wiggling-abelson.md):
1. **Sort specificity**: Length-desc singleDispatch (long specific > short general).
2. **Expand rules**: ~40 singleDispatch, 4 multiDispatch, chainTaskTypes for chains.
3. **Chain override**: dispatcher.ts use chainTaskTypes[taskAgent] if present.
4. **Types**: Add chainTaskTypes to config.
5. **Test**: coordinator.test.ts extensions.

## Detailed Code Update Plan

**1. src/types/agents.ts** (types only):
```
interface ChainDispatchConfig {
  chain: AgentId[];
  passFields?: Record<string, string[]>;
  chainTaskTypes?: Record<AgentId, string>;  // NEW: per-agent taskType override
}

interface AgentsConfig {
  routingRules: {
    singleDispatch: Record<string, AgentId>;
    multiDispatch: Record<string, AgentId[]>;
    chainDispatch: Record<string, ChainDispatchConfig>;  // NEW type
  };
  // ...
}
```

**2. src/coordinator/router.ts** - Fix key specificity:
```
private matchRules(text: string): RoutingDecision | null {
  if (!this.agentsConfig) return null;
  const lower = text.toLowerCase();

  // SINGLE: Length-desc sort NEW
  const sortedSingle = Object.entries(this.agentsConfig.routingRules.singleDispatch)
    .sort(([a], [b]) => b.length - a.length);  // LONGEST FIRST
  for (const [prefix, target] of sortedSingle) {
    if (lower.includes(prefix.toLowerCase())) {
      return { intent: prefix, confidence: 0.95, dispatchMode: 'single', targets: [target as AgentId] };
    }
  }

  // Multi unchanged
  for (const [key, targets] of Object.entries(this.agentsConfig.routingRules.multiDispatch)) {
    if (lower.includes(key.toLowerCase())) {
      return { intent: key, confidence: 0.95, dispatchMode: 'parallel', targets: targets as AgentId[] };
    }
  }

  // Chain unchanged (order preserved)
  // ...
}
```

**3. src/coordinator/dispatcher.ts** - Chain taskType override NEW:
```
async dispatchChain(chain: AgentId[], initialRequest: TaskRequest): Promise<TaskResult> {
  let currentRequest = initialRequest;
  let lastResult: TaskResult | null = null;

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]!;
    const agentsConfig = await this.loadAgentsConfig(); // Assume loaded
    const chainRule = agentsConfig.routingRules.chainDispatch[initialRequest.taskType];
    const taskTypeOverride = chainRule?.chainTaskTypes?.[target] ?? initialRequest.taskType;

    const request: TaskRequest = {
      ...currentRequest,
      toAgent: target,
      taskType: taskTypeOverride,  // OVERRIDE
      context: {
        ...currentRequest.context,
        chainPosition: i,
        chainTotal: chain.length,
        upstreamData: lastResult?.result ?? {},
      },
    };

    // rest unchanged
  }
}
```

**4. config/agents.json** - Expanded rules NEW (~40 single, 4 multi, chainTaskTypes):
```
{
  "routingRules": {
    "singleDispatch": {
      // Existing ~26 + NEW (~14 more)
      "schedule_": "calendar", "reschedule_": "calendar", "cancel_event": "calendar", "whats_my_schedule": "calendar",
      "draft_email": "comms", "send_message": "comms", "reply_to": "comms", "email": "comms", "sms": "comms", "text": "comms",
      "linkedin": "comms", "letter to": "comms",
      "who is": "relationship", "lead status": "relationship", "pipeline": "relationship", "sentiment": "relationship", "sphere": "relationship",
      "write_listing": "content", "create_post": "content", "listing description": "content", "social post": "content", "neighborhood guide": "content", "campaign email": "content", "just listed": "content", "just sold": "content",
      "pull_comps": "research", "market stats": "research", "market timing": "research", "property data": "research", "what's the market": "research", "comps for": "research",
      "transaction": "transaction", "document track": "transaction", "disclosure": "transaction", "escrow": "transaction", "closing": "transaction",
      "expense": "ops", "mileage": "ops", "preferences": "ops",
      "plan_open_house": "open_house", "open house": "open_house",
      "fair housing": "compliance", "wire fraud": "compliance", "disclosure audit": "compliance"
    },
    "multiDispatch": {
      "new_listing": ["content", "research", "comms", "ops", "open_house"],
      "prep_for_meeting": ["calendar", "relationship", "research", "transaction"],
      "follow_up_with": ["relationship", "comms"],
      "market analysis": ["research", "content"]  // NEW
    },
    "chainDispatch": {
      "find_and_send": {
        "chain": ["relationship", "research", "content", "comms"],
        "chainTaskTypes": {
          "relationship": "follow_up_with",
          "research": "market_data",
          "content": "email_campaign_content",
          "comms": "send_message"
        }  // NEW
      },
      "open house": {
        "chain": ["open_house", "calendar", "content"],
        "chainTaskTypes": {
          "open_house": "plan_open_house",
          "calendar": "schedule_event",
          "content": "social_batch"
        }  // NEW
      }
    }
  },
  "intentClassification": { "tier": "fast", "confidenceThreshold": 0.8, "clarifyOnAmbiguity": true }
}
```

**Dependent Files**:
- types/agents.ts (ChainDispatchConfig)
- coordinator.test.ts (+ tests for sort, keywords, chain override)

**Follow-up Steps**:
1. Implement types → router.ts sort → agents.json → dispatcher.ts chainTaskTypes.
2. Extend coordinator.test.ts (5 → 10 tests: key order, chain override, new keywords).
3. `npm test tests/unit/coordinator/` verify.
4. Demo curl:
   ```
   curl -X POST http://localhost:18789/message -d '"email John about showing"'
   # → singleDispatch "email" → comms
   curl -d '"draft email to John"'
   # → "draft_email" (longer) → comms (post-sort)
   curl -d '"find and send to warm leads"'
   # → chain with taskType overrides
   ```

**Expected Impact**: 95%+ keyword coverage, 0 LLM fallback for common tasks, chain works end-to-end.

Approve plan → execute step-by-step?

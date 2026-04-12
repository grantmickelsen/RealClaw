# Phase 2C: Missing Handlers Implementation Plan

## Information Gathered
**Codebase**:
- BaseAgent: ask, queryAgent, read/writeMemory, emitEvent, successResult/failureResult, queryResponse.
- Agent configs define capabilities[] (routing targets).
- Existing switches have some handlers; default LLM fallback.

**Current Gaps** (from AGENT_CONFIGS/capabilities vs code):
```
Ops: preference_manage 
Relationship: sentiment_analysis, pipeline_tracking, contact_enrichment
Comms: linkedin_dm, letter_draft
Research: market_timing, property_data
Transaction: document_track, disclosure_track, escrow_monitor
Content: email_campaign_content, neighborhood_guide
Calendar: reschedule, cancel_event, conflict_detect, prep_block
```

## Plan (Sequential, 1 handler/file)
**1. src/agents/ops/ops.ts - preference_manage**
```
case 'preference_manage': {
  const action = String(request.data['action'] ?? 'read');
  if (action === 'read') {
    const mem = await this.readMemory({ path: 'system/preferences.md' });
    return success({ preferences: mem.content });
  } else {
    const preferenceKey = String(request.data['key']);
    const value = request.instructions;
    await this.writeMemory({
      path: 'system/preferences.md',
      operation: 'append',
      content: `${preferenceKey}: ${value}`,
    });
    return success({ updated: true });
  }
}
```
Test: read returns content, write appends.

**2. src/agents/relationship/relationship.ts - sentiment_analysis**
```
case 'sentiment_analysis': {
  const content = String(request.data['content'] ?? request.instructions);
  const analysis = await this.ask(`Classify sentiment: ${content}\nReturn JSON {sentiment: 'positive'|'neutral'|'negative'|'urgent', confidence: 0.0-1.0, summary}`, ModelTier.FAST);
  const parsed = JSON.parse(analysis.match(/\{.*\}/)?.[0] ?? '{}');
  if (parsed.sentiment === 'negative' || parsed.sentiment === 'urgent') {
    this.emitEvent('contact.sentiment_flag', { contactId: request.context.contactId, sentiment: parsed });
  }
  return success(parsed);
}
```
Test: LLM JSON → flag emit.

**3. src/agents/relationship/relationship.ts - pipeline_tracking**
```
case 'pipeline_tracking': {
  const results = await this.memSearch.search({ domain: 'contacts', query: 'Stage:', maxResults: 50 });
  const grouped: Record<string, string[]> = {};
  for (const match of results.matches) {
    const mem = await this.readMemory({ path: match.path, section: 'Overview' });
    const stageMatch = mem.content.match(/Stage:\s*([^\n]+)/i);
    const stage = stageMatch?.[1]?.trim() ?? 'Unknown';
    grouped[stage] = grouped[stage] ?? [];
    grouped[stage].push(match.path);
  }
  return success({ pipeline: grouped });
}
```
Test: search/group by Stage.

**4. src/agents/comms/comms.ts - linkedin_dm**
```
case 'linkedin_dm': {
  // Same flow as email_draft
  const contextData = await this.getContactContext(contactId);
  const complianceOk = await this.checkCompliance(request.instructions);
  if (!complianceOk.passed) return ...;
  
  const draft = await this.ask(`Draft LinkedIn DM: ${request.instructions}... Tone: professional/networking`, ModelTier.FAST);
  return success(draft, { approval: { actionType: 'send_linkedin_dm', medium: 'linkedin_dm' } });
}
```
Test: approval linkedin_dm.

**5+**: Similar pattern: LLM + memory/query/emit/write → structured response ± approval.

**Dependent Files**:
- config/agents.json (add capabilities to singleDispatch if missing)
- src/types/agents.ts (update capabilities arrays)
- Tests/unit/agents/* (add handler tests)

**Followup Steps**:
1. User approve plan
2. Create TODO.md Phase2C sequence
3. One-by-one: read_file agent.ts → edit_file add case → test → verify
4. npm test after each.

**Confirm before edits?**

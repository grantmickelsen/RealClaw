# Phase 2 TODO

## Completed
- [x] Phase 2B: 9 test files (63 tests)
- [x] Phase 2C: Ops/Relationship/Comms/Content handlers + tests
- [x] Phase 2D Plan

## Phase 2D Routing (4 steps)
1. [ ] types/agents.ts: ChainDispatchConfig + chainTaskTypes
2. [ ] router.ts: sortedSingle length-desc
3. [ ] dispatcher.ts: dispatchChain taskType override from chainRule.chainTaskTypes[target]
4. [ ] agents.json: 40 singleDispatch, 4 multiDispatch, chainTaskTypes
5. [ ] coordinator.test.ts: 10 tests (sort, keywords, chain override)
6. [ ] npm test tests/unit/coordinator/
7. [ ] Update fizzy-wiggling-abelson.md log

## Validation
- curl localhost:18789/message '"email John showing"' → comms 'email'
- '"draft email John"' → 'draft_email' (sort works)
- '"find and send"' → chain taskType overrides


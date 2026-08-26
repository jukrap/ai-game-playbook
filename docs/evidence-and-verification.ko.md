---
source: docs/evidence-and-verification.md
source_sha256: 16b6cd4ab364d01af1c7deb551cd3224e62830d40b7a38d99ac1a2f84d244a86
translated_at: 2026-08-27
---

# 증거와 검증

> 상태: receipt/checkpoint 계약, settlement 경계, durable checkpoint chain, private durable receipt record, private content-addressed artifact payload, pure process/test result normalizer를 구현했습니다. Evidence command, report parser, export, format QA, engine evidence는 아직 없습니다.

[English](evidence-and-verification.md) · [문서](README.ko.md)

## 증거 등급

| 등급 | 확립하는 내용 |
| --- | --- |
| `documented` | 검토한 문서에 behavior가 명시됨 |
| `implemented` | 해당 implementation의 위치를 찾고 검사할 수 있음 |
| `test-witnessed` | 관련 automated test와 결과를 목격함 |
| `locally-executed` | behavior를 local에서 완전한 result와 함께 실행함 |
| `engine-verified` | 의도한 engine/runtime environment에서 required behavior를 complete evidence와 함께 실행함 |

등급에는 순서가 있지만 서로 바꿀 수 없습니다. document, code path, fixture, screenshot, successful process는 필요한 witness 없이 더 강한 evidence로 승격할 수 없습니다.

## `RunReceipt`

구현된 receipt 계약은 다음을 하나의 run identity에 결합합니다.

- project, exact feature contract, resolved workflow plan, step/phase/attempt, Editor session, 선택적 engine, environment identity.
- registry, command descriptor, handler, input, authorization request, approval, 선택적 pack digest.
- start/end time, timeout/cancellation state, outer exit, inner operation result, component outcome.
- log, complete test report, gameplay assertion, input trace, state snapshot, capture, profile, build, export, artifact hash.
- changed file, before/after hash, dirty-state reconciliation, rollback attempt, recovery result.
- 필요 시 approval, network destination, transmitted data class, provider/model information, cost.

private workflow state machine은 immutable checkpoint를 가로질러 domain-separated hash-linked receipt chain을 만들고 성공적으로 정산된 complete artifact만 수용합니다. canonical checkpoint record는 compare-and-swap head와 함께 append-only로 유지됩니다. load는 제한된 parent chain, transition 적법성, record/head digest, 현재 registry plan, project identity, input, feature, dirty-state, session binding을 검증합니다. malformed state를 대체하지 않고 그대로 보존한 채 거부합니다. safe hydration은 직렬화된 authorization을 되살리지 않습니다. dispatch하지 않은 admission은 authorization checkpoint로 돌아가고 dispatch 후 정산하지 못한 action은 `uncertain`이 됩니다.

Private promotion API는 complete artifact source를 stable project-local regular-file snapshot으로 검증하고 선언한 byte count와 SHA-256 digest를 확인한 뒤 immutable digest-addressed object를 기록합니다. Promoted receipt는 original portable source path와 canonical manifest digest를 직접 증명합니다. Create-only manifest는 해당 source와 retained object를 receipt 실행 context, project/runtime identity, registry, command descriptor, handler, input, authorization, pack, approval에 결합합니다. 같은 receipt/artifact identity를 다른 byte나 authority에 재사용하면 거부하며 동일한 동시 promotion은 수렴합니다. Partial failure는 receipt head를 전진시키지 않지만 후속 retention 분석 대상인 unreachable immutable byte가 남을 수 있습니다.

Private receipt store는 promoted `RunReceipt` body를 run별 compare-and-swap head 뒤의 canonical immutable record로 영속화합니다. Persistence는 같은 canonical project root, runtime, registry, command, workflow plan, 선택적 feature contract를 결합합니다. Diagnostic에는 explicit redaction marker가 필요하고 명백한 credential-shaped text와 absolute private-machine path pattern을 거부하며 record, chain, artifact count, artifact byte에 고정 budget을 적용합니다. 모든 complete artifact는 exact CAS object path와 일치하는 manifest를 사용해야 하며 load는 둘을 두 번 다시 엽니다. Promotion 뒤 source file은 evidence authority가 아닙니다. Missing, malformed, noncanonical, tampered, relocated, rebound, stale, competing state는 repair하거나 조용히 교체하지 않고 그대로 보존한 채 거부합니다.

현재 artifact slice는 검증하는 receipt chain 하나에서 complete artifact 최대 256개, 총 64 MiB, manifest 128 KiB로 제한됩니다. Engine artifact parse/decode, image dimension 또는 receipt field를 넘어선 runtime-frame provenance 검증, retention cleanup/reachable-head GC, list/show/export command, record encryption, 다른 registry authority 아래의 과거 chain load는 제공하지 않습니다. Approval reservation과 uncertainty를 해제하는 action도 아직 durable하지 않습니다.

## Test 판정 기준

구현된 private normalizer는 bounded process result와, test의 경우 이미 구조화된 report observation을 받습니다. Process result를 다시 검증하고 zero/nonzero exit, spawn failure, timeout, idle timeout, output limit, cancellation, unconfirmed termination을 고정 outcome으로 매핑합니다. Normalized output은 bounded digest와 counter를 유지하지만 raw stdout/stderr는 포함하지 않습니다.

Test outcome은 report 이전 process failure, missing/incomplete/unparseable report, 일치하지 않는 count, assertion failure, all-skipped execution, zero discovered test, missing required test ID, post-result process failure/cancellation/uncertainty, success를 구분합니다. Success에는 complete report, 0보다 큰 executed test count, 모든 required test ID, passing assertion, clean process result가 필요합니다. Count가 일치하지 않는 report는 receipt-compatible test summary로 투영하지 않습니다. Retry는 첫 failure를 보존하며 deterministic divergence를 숨길 수 없습니다.

이 계층은 XML/JSON report를 parse하거나 engine/test process를 실행하거나 required test ID를 선택하거나 receipt를 기록하거나 command를 노출하지 않습니다. Engine adapter가 bounded report parser를 제공하고 normalized outcome을 같은 run authority에 결합해야 verification에서 사용할 수 있습니다.

gameplay outcome, capture outcome, performance outcome, build outcome은 test outcome과 분리합니다. unit suite 통과만으로 collectible, HUD binding, save/load, packaged startup의 동작을 증명할 수 없습니다.

## 결정적 playtest

playtest는 engine의 실제 input mapping을 통해 fixed 또는 physics tick에 예약한 relative input을 사용합니다. teleport와 direct state mutation은 diagnostic action이며 player input이 아닙니다. 각 scenario는 seed, initial state, input trace, state oracle, required artifact, budget을 고정합니다.

determinism은 선언한 gameplay observation이 명시한 environment와 tolerance 안에서 반복됨을 뜻합니다. 서로 다른 hardware, driver, renderer, physics build, model version에서 bitwise identity를 뜻하지 않습니다.

## Runtime capture

실제 play에서 capture한 frame만 runtime visual evidence가 될 수 있습니다. Editor preview, scene thumbnail, imported image는 다른 evidence class입니다. file completion, decode, dimension, provenance field, hash를 확인한 뒤에만 capture를 수용합니다.

visual score는 advisory입니다. gameplay-state failure, missing interaction, critical visual finding, mismatched baseline identity를 덮을 수 없습니다.

## 공통 golden task

1. deterministic 3D graybox를 reset합니다.
2. 실제 player input으로 이동합니다.
3. camera behavior와 collision을 검증합니다.
4. item을 수집합니다.
5. gameplay score와 HUD counter 증가를 검증합니다.
6. save한 뒤 process 또는 session을 restart합니다.
7. load하고 world와 score 복원을 검증합니다.
8. failure와 restart 경로를 실행합니다.
9. 나머지를 수집하고 win state를 검증합니다.
10. 실제 runtime frame을 capture하고 clean exit합니다.
11. Windows target build 또는 export에서 핵심 behavior를 반복합니다.

## Performance와 지원 주장

performance는 project가 선언한 budget과 hardware, driver, engine, renderer, setting, scene, workload가 같은 baseline으로 판단합니다. budget 또는 비교 가능한 environment identity가 없으면 result는 `unverified`입니다.

required golden scenario, recovery behavior, target build/export evidence가 통과한 뒤에만 engine capability가 `verified`에 도달합니다. missing artifact, partial run, dependency-blocked run, timeout, zero-test execution은 절대 success로 보고하지 않습니다.

---
source: docs/evidence-and-verification.md
source_sha256: 8552f1627598a3289538ec78d588610978bda0eb0db69e7ecd88efc642a61ab2
translated_at: 2026-08-26
---

# 증거와 검증

> 상태: 계획된 검증 계약입니다. 제품 receipt나 engine evidence는 아직 없습니다.

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

계획된 receipt는 다음을 하나의 run identity에 결합합니다.

- project, feature, workflow, step, process, Editor session, engine, version, renderer, scene/world, camera identity.
- registry, command, handler, tool, input, configuration, environment digest.
- start/end time, timeout/cancellation state, outer exit, inner operation result, component outcome.
- log, complete test report, gameplay assertion, input trace, state snapshot, capture, profile, build, export, artifact hash.
- changed file, before/after hash, dirty-state reconciliation, rollback attempt, recovery result.
- 필요 시 approval, network destination, transmitted data class, provider/model information, cost.

receipt는 checkpoint와 handoff를 가로질러 hash-linked chain을 이룹니다. resume에는 project/workflow identity 일치, 유효한 TTL, 변경되지 않은 approved scope가 필요하며 session 또는 external action이 바뀌면 approval을 갱신해야 합니다.

## Test 판정 기준

test outcome은 process failure, incomplete report, assertion failure, all-skipped, zero test, post-result crash, success를 구분합니다. success에는 complete report, 0보다 큰 test count, 모든 required test ID, passing assertion이 필요합니다. retry는 첫 failure를 보존하며 deterministic divergence를 숨길 수 없습니다.

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

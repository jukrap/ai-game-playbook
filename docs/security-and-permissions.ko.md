---
source: docs/security-and-permissions.md
source_sha256: 40541ebeb8d391be4bb727d8e6ef4e42b28431eda0f7a715f2b7b6c4ed25ca49
translated_at: 2026-08-26
---

# 보안과 권한

> 상태: 초기 private admission, workflow-checkpoint, durable checkpoint-store, pack 전용 transaction executor가 포함된 계획된 permission 정책입니다. 일반 command dispatch, Editor 또는 bridge enforcement는 아직 없습니다.

[English](security-and-permissions.md) · [문서](README.ko.md)

## 기본 권한 모델

| 행동 | 계획된 기본값 |
| --- | --- |
| Project file read와 state inspect | 선택한 project 안에서 허용 |
| 승인된 feature contract 안의 source 변경 | 선언한 path/change budget 안에서 허용 |
| Editor control | project와 Editor session별 한 번 승인 |
| 승인된 test와 build 실행 | 설정한 time/output/resource budget 안에서 허용 |
| Pack 또는 skill install/update | 매번 별도 승인 |
| Network 접근 | 매번 별도 승인 |
| Project data 외부 전송 | 매번 별도 승인 |
| 유료 provider 호출 | 매번 별도 승인 |
| 파괴 작업 | 매번 별도 승인 |
| Publish 또는 release | 매번 별도 승인 |

permission은 control plane이 평가하며 MCP annotation, skill, engine bridge, host UI에 위임하지 않습니다. approval은 project identity, command, scope, 필요한 경우 session, budget, expiration에 결합합니다.

현재 private broker는 같은 process에서 검증한 registry instance만 받습니다. 실제 command payload를 등록 input schema로 검증하고 그 digest를 project, command/handler, registry, feature, workflow step, Editor session, 정규화된 target, budget, deadline, run에 결합하며 설정된 public key로 domain-separated 단일 permission Ed25519 grant를 검증합니다. 민감한 grant는 한 번만 사용할 수 있고 authorization lease를 반환하기 전에 동기적으로 reserve합니다. 자동 admission은 범위가 제한된 project read, 승인된 feature source path와 change kind, approval checkpoint를 선언하지 않은 등록 test/build workflow step으로 제한합니다. test/build 권한은 project file 또는 Editor object mutation 권한을 암묵적으로 포함하지 않습니다. Editor object source mutation은 object operation type을 feature contract와 대조할 수 있을 때까지 거부합니다.

authorization 자체가 실행은 아닙니다. 일반 broker는 command dispatcher, CLI, MCP, process workflow, engine bridge와 아직 연결되지 않았습니다. 좁은 예외로 private pack executor가 있습니다. 같은 process에서 준비한 plan, exact path와 보수적인 rollback budget에 결합된 broker-issued `install` 결정, attest된 `project-write` lease를 모두 받은 뒤에만 filesystem CAS를 호출합니다. grant use count와 active lease는 memory에만 있어 restart를 넘지 못하며 approval UI, durable approval 또는 revocation store, recovery action, secret-path classifier도 없습니다. registry는 exact validated authority에서 domain-separated workflow-plan digest를 파생하고 모호한 binding을 거부하며 immutable plan을 의미 검증합니다. workflow state machine은 broker 결정을 받기 전에 이 plan을 다시 해석하고 exact authorization과 실제 effect를 각 transition에 결합합니다. durable checkpoint store는 그 결과인 uncertainty barrier를 restart 뒤에도 보존하지만 stale authorization capability를 의도적으로 버리고 uncertainty를 reconcile하거나 해제하지는 못합니다. runtime enforcement와 accounting이 없는 동안 memory, CPU, GPU request budget은 거부합니다.

## Fail-closed 중단 조건

다음 중 하나라도 발생하면 추가 mutation 전에 실행을 중단합니다.

- 가능한 project 또는 Editor instance가 둘 이상입니다.
- project, engine, process, session, scene/world, feature-contract identity가 바뀝니다.
- owned 또는 approved path 밖의 file을 변경하려 합니다.
- 예상하지 않은 dirty file이나 compare-and-swap mismatch가 나타납니다.
- path traversal, symlink escape, stale PID, invalid token, schema mismatch를 탐지합니다.
- time, output, changed-file, changed-byte, repair, resource, cost budget을 초과합니다.
- operation이 불확실한 mutation state로 끝납니다.
- required test가 없거나 incomplete, all-skipped, zero-test입니다.

불확실한 mutation은 자동 재시도하지 않습니다. workflow는 먼저 `uncertain` receipt를 기록하고 state reconciliation 또는 명시적 recovery를 요구합니다.

## Process와 Editor 격리

현재 private core는 local executable과 project root를 digest로 결합하고 argument array로 직접 spawn합니다. environment value와 project-scoped working directory를 제한하고 time, idle time, combined output 상한을 적용하며 중단 시 owned process tree만 종료합니다. Windows에서는 최소한의 비민감 OS 기준값만 유지하고 명시적으로 allowlist하지 않은 inherited user/path value를 가립니다. 중단된 실행은 mutation-uncertain으로 유지하며 reconcile 전에는 안전하게 retry할 수 없습니다. 이 경계는 CPU, memory, filesystem 또는 network sandbox가 아닙니다.

현재 private core는 초기화된 project마다 고정 local lease 하나를 사용해 `project-write`, `editor-bound`, `build-bound` 작업을 admission합니다. record는 root/project digest, run UUID, PID, 캡처한 runtime-start identity, runtime nonce, lane, 필요한 경우 Editor-session digest를 결합합니다. acquisition은 제한된 대기와 cancellation을 사용하며 갱신은 명시적으로 수행하고 compare-and-swap으로 보호합니다. 만료만으로는 takeover할 수 없습니다. live, reused 또는 확인할 수 없는 foreign PID는 계속 차단하고 dead owner record만 재획득 전에 atomic quarantine합니다. foreign live process start time은 아직 OS에서 독립적으로 attest하지 않으며 automatic heartbeat, parallel-reader coordination, 실제 Editor session 제어도 없습니다.

계획된 local bridge는 인증된 project-scoped session, 제한된 request body/queue, timeout, cancellation, normalized outer/inner error를 사용합니다. 기본으로 loopback에 bind하고 unauthenticated server를 노출하지 않습니다.

## Filesystem과 pack 안전

현재 core는 canonical project root를 결합하고 writable path link와 portable path ambiguity를 거부하며 제한된 staged SHA-256 compare-and-swap 쓰기와 exact-digest 단일 파일 삭제를 수행합니다. 고정 레이아웃 bootstrap은 caller가 선택한 경로나 recursive 삭제 없이 runtime directory 6개만 한 segment씩 생성합니다. parent와 target identity를 확인하고 동시 생성은 재검사 뒤에만 멱등으로 받아들이며, 실패한 호출이 직접 만든 directory만 역순 정리하고 모호한 정리는 mutation-uncertain으로 보고합니다. private pack preflight는 같은 process에서 검증한 registry와 offline·hook-free regular-file artifact만 받습니다. local content, canonical installed state, exact dependency, downgrade policy, owned hash, 비소유 충돌, resource limit를 확인한 뒤 immutable write-free plan을 만듭니다. control-plane state와 lock namespace는 pack 소유 대상에서 제외합니다. pack executor는 pack artifact parent directory를 만들거나 authority를 직접 얻지 않습니다. 해당 artifact parent는 미리 존재해야 하고 caller가 exact 승인 결정과 lane을 제공해야 합니다. transaction 시작 전과 각 forward staging·commit 경계 전후에 lease 만료를 다시 검사합니다. 승인 scope와 rollback budget은 고정 active marker, 두 journal record, installed state, 모든 artifact, capture한 rollback preimage를 포함합니다. marker는 started record 시도 전에 pre/post installed-state file digest와 observation limit를 포함한 기대 started record 전체를 담습니다. 불확실하지 않은 terminal만 exact marker digest를 지우며, marker가 남았거나 malformed이면 preflight와 execution을 중단합니다. state만 바꾸는 update의 unchanged file을 포함한 최종 artifact digest를 installed-state commit 전에 write-free CAS guard로 확인합니다. final-file effect 전에 immutable started record를 쓰고 state와 artifact를 stage하며 canonical installed state를 마지막에 commit한 뒤 terminal record와 실제 path/byte settlement를 남깁니다. 뒤 operation의 명확한 실패는 앞 file commit을 exact digest로 역순 rollback하고 uncertain commit은 retry 없이 중단합니다. recovery inspector는 write-free 상태로 제한된 관찰을 두 번 수행하며 mixed, unstable, unreadable, terminal contradiction 또는 foreign marker 상태를 승격하지 않습니다. marker를 지우거나 terminal을 재구성하지 않으므로 별도로 승인된 recovery action이 여전히 필요합니다. pack이 현재 registry에서 사라져도 installed-state 소유권을 기준으로 remove할 수 있습니다. CLI, 승인 결합 recovery finalizer, pack 소유 directory lifecycle, pack 획득 경로는 아직 없습니다.

path 검사는 최종 target을 resolve하고 traversal, absolute-path injection, symlink escape를 거부합니다. engine과 system tool은 탐지하지만 자동 설치하지 않습니다.

## Network, provider, telemetry

telemetry는 계획하지 않습니다. 일반 evidence는 local에 남습니다. 외부 evidence export, network access, provider call은 destination, data category, retention expectation, model/provider identity, estimated cost를 포함해 따로 승인해야 하는 action입니다.

hosted provider는 기본 disabled입니다. 첫 버전은 optional image provider pack 최대 하나만 허용할 수 있습니다. install approval은 이후 transmission 또는 paid call을 허가하지 않습니다.

## Secret과 공개 산출물

secret과 local connection detail은 ignore된 machine-local configuration에 둡니다. raw value가 secret을 노출한다면 receipt에는 redacted command 정보와 hash를 저장합니다. 사용자가 명시적으로 선택하고 승인하지 않는 한 public document, export, diagnostic은 private absolute path, token, internal URL, raw local configuration을 제외해야 합니다.

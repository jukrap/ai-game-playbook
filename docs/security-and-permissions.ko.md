---
source: docs/security-and-permissions.md
source_sha256: e86a884fa55eb48828a1cc87c981e8af5f3d3f34d9547809504cade9bb8cc7bc
translated_at: 2026-08-27
---

# 보안과 권한

> 상태: private admission, workflow checkpoint, durable receipt/artifact record, managed-pack transaction, read-only CLI diagnostic가 구현된 계획 permission policy입니다. General mutation dispatch와 engine enforcement는 아직 없습니다.

[English](security-and-permissions.md) · [문서](README.ko.md)

## 현재 enforcement

현재 private broker는 같은 process에서 validate한 registry만 받습니다. Registered schema로 command input을 검증하고 project, command/handler, registry, feature, workflow step, optional Editor session, normalized scope, budget, deadline, run identity에 authorization을 결합합니다. Sensitive authority는 one-permission Ed25519 grant, exact scope, expiration, single-use reservation을 사용합니다.

Authorization 자체는 execution이 아닙니다. Broker는 general mutation dispatcher, MCP server, process workflow, engine bridge와 연결되지 않았습니다. 좁은 pack executor와 stable-state recovery finalizer는 각각 same-process plan, exact `install` decision, attest된 project-write lease를 요구합니다. Grant reservation과 active lease는 memory-only이며 restart 뒤 유지되지 않습니다.

현재 CLI는 plan-only `init`, read-only `doctor`, static read-only `project inspect`를 dispatch합니다. 세 descriptor 모두 `read-project`, side effect 없음, `parallel-read` lane, changed-file/changed-byte budget 0을 선언합니다. 어느 명령도 elevated authority를 요청하거나 repair를 호출하거나 mutation lane에 진입할 수 없습니다.

Static project inspection은 local root 하나를 bind하고 directory observation과 file byte를 제한하며 unsafe link와 case ambiguity를 거부하고 read 전후 identity를 다시 확인합니다. `.git` marker는 Git 실행 permission을 부여하지 않으며 Editor lock은 process, session, liveness, connection, mutation authority를 부여하지 않습니다. Report는 mutation, process launch, network access가 없음을 명시합니다. Invalid profile과 ambiguous engine candidate는 그럴듯한 target을 선택하지 않고 이후 authority를 차단합니다.

Private artifact promotion과 receipt store는 current same-process validated registry와 exact project, runtime, command descriptor, handler, workflow plan, 선택적 feature contract에 결합된 receipt만 수용합니다. 미리 존재하는 ignored local directory, stable project-local source snapshot, digest-addressed create-only object, canonical producer manifest, canonical receipt JSON, compare-and-swap head, explicit diagnostic redaction marker, bounded text/artifact를 요구합니다. 검증 중 complete artifact object와 manifest를 두 번 다시 엽니다. Execution authority를 부여하거나 corruption을 repair하거나 mutation을 retry하거나 format QA를 수행하거나 unreachable object를 제거하거나 data를 export하지 않습니다.

별도 private artifact assessor는 추가 authority를 상속하지 않습니다. I/O 전에 request를 snapshot하고 exact promoted complete artifact 하나를 요구하며 보존 byte를 읽기 전후에 receipt/object/manifest를 검증하고 고정된 byte, JSON tree, PNG dimension, pixel, inflate, chunk limit을 적용합니다. 선택적 provenance validation은 exact current registry와 current-file identity를 요구합니다. Assessor는 raw content 대신 bounded code와 metadata를 반환하며 write, process launch, network access, engine control, export, retry, repair, support-grade promotion을 수행하지 않습니다. 지원하지 않는 interlaced PNG는 `unverified`로 남습니다.

## 기본 permission 모델

| 동작 | 기본값 |
| --- | --- |
| 선택한 project file과 local state 읽기 | Bounded path 안에서 허용 |
| 승인된 feature contract 안의 source 변경 | 선언한 path, change, budget scope 안에서만 허용 |
| Editor 제어 | Project와 Editor session마다 한 번 승인 |
| 승인된 test/build 실행 | 설정한 time, output, resource budget 안에서 허용 |
| Pack/skill install, update, remove | 매번 별도 승인 |
| Network access | 매번 별도 승인 |
| Project data 외부 전송 | 매번 별도 승인 |
| Paid provider call | 매번 별도 승인 |
| Destructive action | 매번 별도 승인 |
| Publish/release | 매번 별도 승인 |

MCP annotation, skill text, engine bridge, host UI label은 permission을 부여하지 않습니다. Blanket `--yes`로 installation, network, external transmission, paid call, destructive work, publish를 묶어 승인해서는 안 됩니다.

## 초기화 계획 경계

`agpb init`은 고정된 16개 target의 project layout을 관찰하고 검증된 plan만 반환합니다. Directory 생성, profile/policy byte 쓰기, pack 설치, network access, mutation authority 예약을 수행하지 않습니다. 예상 filesystem kind와 일치하는 기존 target은 retain하며 type, case, link, parent, observation conflict는 충돌 대상을 변경하지 않고 plan을 차단합니다. Retain은 기존 metadata 내용의 유효성을 검증하지 않습니다.

Ready plan은 runtime registry, canonical project identity, 정렬된 target intent, 관찰된 target state를 결합한 digest를 가집니다. 이 digest는 plan drift를 탐지하지만 approval grant, write lease, checkpoint, apply token이 아닙니다. 별도 mutation contract와 permission path가 구현되기 전까지 `--apply`는 invalid usage로 거부됩니다.

## Doctor 경계

`agpb doctor`는 runtime registry, Node.js version, canonical project root, fixed runtime directory, installed-pack state, active transaction marker를 bounded local read로 검사합니다. 완성된 report는 rendering 전에 registry 결합 output schema로 검증합니다.

Doctor는 fail-closed로 동작합니다.

- 미초기화 project는 directory를 만들지 않고 attention으로 보고합니다.
- Unavailable 또는 unsafe root는 blocking입니다.
- Incomplete, linked, conflicting runtime state는 blocking입니다.
- Malformed, noncanonical, wrong-project installed state는 blocking입니다.
- Valid, malformed, changing active transaction marker는 blocking입니다.
- Unsupported 또는 malformed runtime-version text는 blocking입니다.

명령은 초기화, repair, delete, clear, finalize, install, engine spawn, network connection, Editor control을 수행하지 않습니다. Human/JSON mode는 같은 report와 exit category를 사용합니다.

## Fail-closed 중단 조건

Mutation run은 다음 중 하나가 발생하면 추가 mutation 전에 중단해야 합니다.

- Plausible project 또는 Editor instance가 둘 이상입니다.
- Project, engine, process, session, scene/world, registry, handler, feature identity가 바뀝니다.
- Owned/approved path 밖의 file을 변경하게 됩니다.
- Unexpected dirty file 또는 compare-and-swap mismatch가 나타납니다.
- Path traversal, link escape, stale identity, invalid token, schema mismatch를 탐지합니다.
- Time, output, changed-file, changed-byte, repair, resource, cost budget을 넘습니다.
- Operation이 uncertain mutation state로 끝납니다.
- Required test가 없거나 incomplete, all skipped, zero tests입니다.

Uncertain mutation은 자동 재시도하지 않습니다. 별도 authority와 receipt를 가진 새 reconciliation 또는 recovery attempt가 필요합니다.

## Process와 Editor isolation

현재 core는 local executable과 project root를 digest-bind하고 argument array로 직접 spawn하며 environment value와 project-scoped working directory를 제한하고 time, idle, combined output을 cap하며 owned process tree만 종료합니다. 종료에 성공해도 interrupted execution은 mutation-uncertain입니다. 이는 CPU, memory, filesystem, network sandbox가 아닙니다.

Mutation lane은 고정 project-local lease 하나를 사용합니다. Record는 root/project digest, run ID, runtime identity, nonce, lane, optional Editor-session digest를 결합합니다. Acquisition은 bounded waiting/cancellation을 가지며 renew는 explicit합니다. Expiration만으로 live 또는 unverifiable owner를 takeover하지 않습니다. Automatic heartbeat, parallel-reader coordination, independent foreign-process start attestation, actual Editor control은 계획 단계입니다.

계획한 local bridge는 authenticated project-scoped session, bounded request body/queue, deadline, cancellation, outer transport와 inner operation result 분리를 사용합니다. 기본 loopback bind이며 unauthenticated mutation server를 노출하지 않습니다.

## Filesystem과 pack safety

Core는 canonical local project root 하나를 bind하고 path ambiguity와 writable link를 거부하며 directory traversal/file size를 제한하고 exact compare-and-swap write, delete, reversible empty-directory removal을 stage합니다. Fixed bootstrap은 predetermined runtime directory 11개만 만들며 실패한 call이 직접 만든 identity만 rollback합니다.

Pack preflight는 write-free이고 validated offline regular-file artifact만 받습니다. Content digest, canonical installed state, dependency, downgrade policy, ownership, non-owned collision, reserved namespace, budget을 검증합니다. Existing directory는 shared입니다. Explicitly declared missing direct artifact parent만 pack-digest-bound ownership marker를 받을 수 있습니다.

Execution에는 exact plan, approved scope, project-write lease가 필요합니다. Started journal record 전에 active marker를 쓰고 compare-and-swap으로 artifact를 commit하며 canonical installed state를 마지막에 commit하고 terminal outcome을 기록한 뒤 non-uncertain terminal에서만 exact marker를 지웁니다. 뒤의 명확한 실패는 detached directory를 복원한 다음 앞서 commit한 file을 역순 rollback합니다. Uncertain commit은 재시도하지 않습니다.

Recovery inspection은 bounded write-free observation을 두 번 수행하고 mixed, unstable, unreadable, contradictory, foreign-marker state를 진단용으로 보존합니다. Finalization은 새 exact approval과 lane을 요구하고 각 write boundary 전에 다시 검사하며 stable attest된 state만 닫고 pack artifact를 repair하지 않습니다. Unexpected tombstone content는 보존하며 cleanup을 차단합니다.

`doctor`는 installed-state corruption이나 remaining marker를 보고할 수 있지만 recovery classify, journal append, marker clear, finalizer 호출은 할 수 없습니다. Mutating pack CLI나 distributed pack acquisition path는 아직 없습니다.

## Network, provider, telemetry

Telemetry는 계획하지 않습니다. Routine evidence는 local에 남습니다. External evidence export, network access, provider call은 destination, data category, retention, provider/model, cost disclosure와 explicit approval이 필요한 별도 action입니다.

Hosted provider는 기본 비활성입니다. 이후 version에서 optional image-provider pack을 최대 하나 허용할 수 있습니다. Installation approval은 이후 transmission이나 paid call을 승인하지 않습니다.

## Secret과 공개 artifact

Secret과 local connection detail은 ignored machine-local configuration에 둡니다. Receipt와 diagnostic은 credential이나 private machine detail을 노출할 수 있는 값을 redact해야 합니다. Public documentation과 export는 사용자가 해당 data를 exact하게 선택하고 승인하지 않는 한 private absolute path, token, internal URL, raw local config를 제외합니다.

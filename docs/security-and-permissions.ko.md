---
source: docs/security-and-permissions.md
source_sha256: 8c9b9d76da2922e05696d231bf605a7ecb9dbeed2a6aa31f063ae1a561207421
translated_at: 2026-08-27
---

# 보안과 권한

> 상태: private admission, workflow checkpoint, durable receipt/artifact record, bounded private receipt-head query, managed-pack transaction, closed-world process-containment assessment와 strict provider/self-test protocol, static Godot status/capability report를 포함한 write-free CLI command 일곱 개, private permission-bound Godot executable discovery와 version probe, fail-closed Godot headless-preflight admission, read-only STDIO MCP 경계, write-free skill-target/Codex configuration planning이 구현된 계획 permission policy입니다. General mutation dispatch와 contained engine execution은 아직 없습니다.

[English](security-and-permissions.md) · [문서](README.ko.md)

## 현재 enforcement

현재 private broker는 같은 process에서 validate한 registry만 받습니다. Registered schema로 command input을 검증하고 project, command/handler, registry, feature, workflow step, optional Editor session, normalized scope, budget, deadline, run identity에 authorization을 결합합니다. Sensitive authority는 one-permission Ed25519 grant, exact scope, expiration, single-use reservation을 사용합니다.

Authorization 자체는 execution이 아닙니다. Broker는 general mutation dispatcher나 engine bridge와 연결되지 않았습니다. Private Godot operation 세 개가 exact broker decision을 직접 소비합니다. Executable discovery는 process를 시작하지 않고 signed single-use host-tool inspection lease를 정산하고, version probe는 bounded process 하나를 둘러싼 별도 lease를 정산하며, headless-preflight admission은 exact containment witness가 `block`을 반환할 때 project process를 시작하지 않고 workflow-bound lease를 실패로 정산한 뒤 blocked receipt를 보존합니다. 현재 MCP runtime은 generated metadata와 registered descriptor가 read-only, closed-world, non-mutating임을 증명하는 command만 노출하며 broker의 elevated permission path를 갖지 않습니다. 좁은 pack executor와 stable-state recovery finalizer는 각각 same-process plan, exact `install` decision, attest된 project-write lease를 요구합니다. Grant reservation과 active lease는 memory-only이며 restart 뒤 유지되지 않습니다.

현재 CLI는 plan-only `init`, read-only `doctor`, static `project inspect`, `skill list`, `skill check`, static read-only `engine status --engine godot`와 `engine capabilities --engine godot`를 dispatch합니다. 일곱 descriptor 모두 `read-project`, side effect 없음, `parallel-read` lane, changed-file/changed-byte budget 0을 선언합니다. 어느 명령도 elevated authority를 요청하거나 repair를 호출하거나 skill을 materialize하거나 mutation lane에 진입할 수 없습니다.

MCP startup에는 bounded project root 하나, explicit generated tool name 하나 이상, 선택한 project diagnostic이 active host에 disclose될 수 있다는 acknowledgement가 필요합니다. Runtime은 canonical path와 filesystem identity를 bind하고 모든 command input을 그 exact project에 다시 bind하며 duplicated, unknown, write-capable, destructive, open-world tool을 거부합니다. 최대 1 MiB인 modern STDIO message만 받고 registered input/output schema와 command deadline을 강제하며 bounded canonical result를 출력하고 HTTP/network access를 노출하지 않습니다. Host approval UI는 host 책임이며 이 acknowledgement는 evidence export나 telemetry consent가 아닙니다.

Shared skill runtime과 Codex setup planner는 caller가 선택한 script/skill path를 받지 않습니다. Skill runtime은 generated registry의 유일한 stable model-invoked skill route를 bind하고 packaged source가 64 KiB 상한 안의 canonical regular file이며 선언 name, UTF-8/LF 형식, frontmatter, SHA-256 digest와 일치하도록 요구합니다. CLI와 MCP는 이 authority에서 bounded catalog metadata와 target observation만 반환합니다. Codex setup은 deterministic project-skill/configuration byte를 반환하기 전에 현재 지원 Node.js executable과 이 installation의 MCP entry point도 bind합니다. Inspection은 runtime identity를 다시 확인하고 linked, case-aliased, type-conflicted, oversized path를 거부하며 target을 분류합니다. 이 경로들은 directory 생성, file write, merge, trust 변경, skill materialization을 수행하지 않습니다.

Static project inspection은 local root 하나를 bind하고 directory observation과 file byte를 제한하며 unsafe link와 case ambiguity를 거부하고 read 전후 identity를 다시 확인합니다. `.git` marker는 Git 실행 permission을 부여하지 않으며 Editor lock은 process, session, liveness, connection, mutation authority를 부여하지 않습니다. Report는 mutation, process launch, network access가 없음을 명시합니다. Invalid profile과 ambiguous engine candidate는 그럴듯한 target을 선택하지 않고 이후 authority를 차단합니다.

Static Godot status와 capability report는 그 exact project 경계를 상속합니다. 공개 request는 선택한 project와 literal `godot` engine identity만 받습니다. Capability report는 status를 재사용하고 immutable compiled containment catalog를 검사한 뒤 고정된 planned operation contract 14개만 출력합니다. Executable, provider, self-test, launch input을 전달하거나 host tool을 검색하거나 bound project 밖 file을 읽거나 process를 launch하거나 Editor를 제어하거나 receipt를 만들거나 support를 승격할 수 없습니다.

Private host-tool inspection은 자동 승인되지 않는 별도 `host-tool-inspection` permission class를 사용합니다. Discovery 준비는 project-only read만 수행하고 configured path 최대 8개와 선택한 PATH directory 최대 32개의 digest 하나를 bind합니다. Broker challenge는 그 digest를 exact object scope로 노출하고 signed single-use grant 하나를 요구합니다. 그 뒤에만 discovery가 configured candidate와 고정 direct name `godot`/`godot4` 또는 `godot.exe`/`godot4.exe`를 검사할 수 있습니다. Recursive scan, ambient PATH state read, process launch, software install, network access를 수행하지 않고 source path도 반환하지 않습니다. 결과 report는 execution authority를 부여하지 않으며 생성한 process 안에서만 사용할 수 있습니다. Version 준비는 그 원본 report 뒤에 보존된 candidate만 받고, dispatch에는 선택한 content/filesystem-identity digest에 scope한 또 하나의 signed single-use grant가 필요합니다. 각 경계 전후에 project/executable identity를 확인하며 active lease는 성공과 실패 모두에서 정산합니다.

Headless-preflight 준비는 같은 process의 원본 completed version report만 받습니다. Project/executable identity를 다시 검증하고 initialized ignored receipt storage를 요구하며 exact registered workflow step 하나를 resolve한 뒤 exact project root와 고정 project-write/network/child-process denial requirement에 대한 path-free core assessment를 얻습니다. Assessment JSON만으로는 execution authority를 얻을 수 없습니다. Core는 원본 report/root 쌍을 same-process witness로 보존하고 copy와 rebinding을 거부하며 사용 전에 project identity를 다시 확인합니다. Assessment request, policy, result, closed provider-catalog digest는 command input과 세 번째 signed approval scope에 bind됩니다. 현재 catalog에는 validated provider가 없고 v1 schema는 unavailable control과 `block`만 표현하며 probe나 project process를 시작하지 않습니다. Adapter는 admission 직전에 원본 witness와 exact digest를 다시 검증합니다. 그 뒤 lease를 non-uncertain failure로 정산하고 authority input과 redacted diagnostic이 같은 assessment를 bind하는 canonical `blocked` receipt 하나를 보존합니다. Admission 전 cancellation이나 identity drift는 authority를 정산하지만 해당 receipt는 만들지 않습니다. 이는 fail-closed admission evidence이지 filesystem/network/child-process sandbox가 아니며 Godot support를 `planned`보다 높일 수 없습니다.

Private artifact promotion과 receipt store는 current same-process validated registry와 exact project, runtime, command descriptor, handler, workflow plan, 선택적 feature contract에 결합된 receipt만 수용합니다. 미리 존재하는 ignored local directory, stable project-local source snapshot, digest-addressed create-only object, canonical producer manifest, canonical receipt JSON, compare-and-swap head, explicit diagnostic redaction marker, bounded text/artifact를 요구합니다. 검증 중 complete artifact object와 manifest를 두 번 다시 엽니다. Execution authority를 부여하거나 corruption을 repair하거나 mutation을 retry하거나 format QA를 수행하거나 unreachable object를 제거하거나 data를 export하지 않습니다.

Private receipt-head query는 write 또는 execution authority를 추가하지 않습니다. Caller가 선택한 limit 아래에서 fixed store만 scan하고 noncanonical/non-file entry를 거부하며 모든 head를 다시 열고 두 번째 inventory observation을 검사한 뒤 bounded summary를 반환합니다. 복사한 summary는 상세 load를 승인할 수 없습니다. Full-chain verification 전에는 원본 same-process witness, 일치하는 project identity, 일치하는 validated registry, 변경되지 않은 selected head가 필요합니다. Head-only discovery는 malformed 또는 검사하지 않은 record content를 verified evidence로 승격하지 않습니다.

별도 private artifact assessor는 추가 authority를 상속하지 않습니다. I/O 전에 request를 snapshot하고 exact promoted complete artifact 하나를 요구하며 보존 byte를 읽기 전후에 receipt/object/manifest를 검증하고 고정된 byte, JSON tree, PNG dimension, pixel, inflate, chunk limit을 적용합니다. 선택적 provenance validation은 exact current registry와 current-file identity를 요구합니다. Assessor는 raw content 대신 bounded code와 metadata를 반환하며 write, process launch, network access, engine control, export, retry, repair, support-grade promotion을 수행하지 않습니다. 지원하지 않는 interlaced PNG는 `unverified`로 남습니다.

## 기본 permission 모델

| 동작 | 기본값 |
| --- | --- |
| 선택한 project file과 local state 읽기 | Bounded path 안에서 허용 |
| Project 밖 exact host-tool candidate 검사 | 매번 별도 signed single-use 승인 |
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

현재 core는 local executable과 project root를 digest-bind하고 argument array로 직접 spawn하며 environment value와 project-scoped working directory를 제한하고 time, idle, combined output을 cap하며 owned process tree만 종료합니다. 종료에 성공해도 interrupted execution은 mutation-uncertain입니다. 이는 CPU, memory, filesystem, network, child-process sandbox가 아닙니다. 따라서 해당 control을 요구하는 engine-backed preflight는 process 생성 전에 중단합니다.

Contract layer에는 path-free provider descriptor와 bounded self-test request/report schema가 생겼습니다. Implementation/catalog digest, fixed probe suite, 짧은 challenge window, exact timing, effect와 outcome 일관성을 결합합니다. Core는 immutable empty compiled catalog만 노출합니다. Self-test process는 실행되지 않았고 등록된 descriptor, current-time/host-identity witness, launch handle도 없습니다. 따라서 valid-looking serialized report, 복사한 catalog, digest는 authority를 부여하지 않으며 기존 `block` admission을 바꿀 수 없습니다.

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

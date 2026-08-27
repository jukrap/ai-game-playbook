---
source: docs/planned-cli.md
source_sha256: 3e6cc2fed4b02b401dcea3ba61403ebd9274bbaa8b6c7633617a2d5c1c61cbd7
translated_at: 2026-08-27
---

# 명령줄 인터페이스 상태

> 상태: 일부 구현 상태입니다. Source-built `agpb` executable이 plan-only `agpb init`, read-only `agpb doctor`, `agpb project inspect`, `agpb pack list`, `agpb pack doctor`, `agpb skill list`, `agpb skill check`, static read-only `agpb engine status --engine godot`와 `agpb engine capabilities --engine godot`를 제공합니다. Published package는 없습니다.

[English](planned-cli.md) · [문서](README.ko.md)

## 명령 목록

```text
agpb init
agpb doctor
agpb project inspect
agpb pack list
agpb pack add
agpb pack update
agpb pack remove
agpb pack doctor
agpb skill list
agpb skill install
agpb skill check
agpb engine status
agpb engine capabilities
agpb engine connect
agpb run <workflow>
agpb verify
agpb evidence list
agpb evidence show
agpb evidence export
agpb docs check
```

[planned-surface.json](planned-surface.json)과 생성된 [foundation plan](../generated/foundation-plan.json)에서 available command entry로 표시된 것은 `agpb init`, `agpb doctor`, `agpb project inspect`, `agpb pack list`, `agpb pack doctor`, `agpb skill list`, `agpb skill check`, `agpb engine status`, `agpb engine capabilities`입니다. 나머지 command entry는 모두 planned이며 skill availability는 foundation plan에서 별도로 보고합니다. Slash-command interface는 약속하지 않습니다.

## 현재 사용 가능

Repository-local executable을 호출하기 전에 workspace를 build합니다.

```shell
pnpm build
pnpm run agpb -- init --project <project-path>
pnpm run agpb -- init --project <project-path> --json
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
pnpm run agpb -- project inspect --project <project-path>
pnpm run agpb -- project inspect --project <project-path> --json
pnpm run agpb -- pack list --project <project-path>
pnpm run agpb -- pack list --project <project-path> --json
pnpm run agpb -- pack doctor --project <project-path>
pnpm run agpb -- pack doctor --project <project-path> --json
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- skill list --project <project-path> --json
pnpm run agpb -- skill check --project <project-path>
pnpm run agpb -- skill check --project <project-path> --json
pnpm run agpb -- engine status --engine godot --project <project-path>
pnpm run agpb -- engine status --engine godot --project <project-path> --json
pnpm run agpb -- engine capabilities --engine godot --project <project-path>
pnpm run agpb -- engine capabilities --engine godot --project <project-path> --json
```

`--project`는 absolute path 또는 현재 working directory 기준 relative path를 받습니다. 생략하면 각 명령이 현재 directory를 선택합니다. `--json`은 해당 명령의 등록된 report를 canonical JSON으로 출력하며 기본 모드는 safe next action이 포함된 간결한 human report입니다.

`init`은 write-plan-only입니다. 고정된 project-local target 20개를 `create`, `retain`, `conflict`로 분류합니다.

- commit 대상인 profile, policy, feature, pack lock, 내부 ignore policy target;
- local-only인 cache, evidence, log, screenshot, lock, local configuration, runtime state target.

현재 planner는 target path의 안전성과 filesystem kind만 검증합니다. `retain`은 기존 profile, lock, ignore-policy 내용이 유효하다는 증거가 아니며 content inspection과 mutation은 아직 계획 단계입니다.

Plan digest는 runtime registry, canonical project identity, 정렬된 target path, kind, policy, content intent, observation, conflict code를 결합합니다. 이는 진단 metadata이며 approval이나 apply authority가 아닙니다. Report는 항상 `mutationPerformed: false`와 `applySupported: false`를 명시하고 `--apply`를 잘못된 사용으로 거부합니다.

`doctor`는 다음을 bounded read-only 방식으로 검사합니다.

- runtime-registry와 generated-surface parity;
- 지원 Node.js 범위;
- canonical local project root 하나;
- receipt와 artifact storage를 포함한 고정 runtime directory 11개;
- canonical installed-pack state;
- active 또는 malformed pack transaction marker.

`pack list`는 canonical project 하나를 bind하고 bounded installed-pack identity, version, manifest digest, timestamp, dependency count, artifact count와 declared byte, owned-directory count를 보고합니다. Artifact path/content, source location, install authority, mutation control은 반환하지 않습니다. Malformed/unstable state와 active transaction은 partial-success listing이 아니라 blocking입니다.

`pack doctor`는 고정 count, byte, time, finding limit 안에서 canonical installed state, current registry identity, 각 declared artifact digest, marker-bound directory ownership, active recovery transaction을 다시 관찰합니다. Current, drifted, unsafe, not-inspected integrity를 구분하고 bounded recovery summary만 보고합니다. Byte repair, marker clear, recovery finalization, artifact content/source location 노출, uncertain mutation 자동 재시도를 수행할 수 없습니다.

`project inspect`는 다음을 bounded static 방식으로 검사합니다.

- canonical project root 하나와 deterministic root entry;
- multiple-candidate ambiguity를 포함한 complete/partial Godot, Unity, Unreal project marker;
- 최대 1 MiB인 BOM-free canonical schema-valid `.ai-game-playbook/profile.json`과 portable identity;
- profile engine/version과 탐지한 marker evidence의 compatibility;
- Git을 실행하지 않는 case-exact `.git` marker;
- PID, liveness, session, selection을 주장하지 않는 `Temp/UnityLockfile` 같은 static Editor signal.

Marker/profile 누락과 관찰하지 않은 dirty/process 상태는 attention finding입니다. Unavailable root, invalid/mismatched profile, engine ambiguity, bounded candidate report 초과는 blocking입니다. 이 명령은 static detection을 engine support로 보고하지 않고 stage evidence content를 검증하지 않으며 engine 실행, operating-system process 열거, Editor 연결, file write, network access를 수행하지 않습니다.

`skill list`는 canonical project 하나를 bind하고 relative artifact/target path, 선언 capability, permission, invocation mode, version, token bound, artifact digest를 포함한 stable registry catalog를 반환합니다. Skill body나 absolute artifact-source path는 반환하지 않습니다. `skill check`는 같은 registry와 packaged artifact를 다시 검증하고 각 project target을 `missing`, `current`, `conflict`, `unsafe`로 분류합니다. Missing target은 attention observation이고 content conflict, byte limit 초과, unsafe linked/aliased path는 blocking입니다. 두 명령 모두 skill을 install, copy, replace, repair, remove하지 않습니다.

`engine status`는 현재 `--engine godot`를 요구합니다. Bounded static project inspection을 재사용해 complete Godot candidate 하나를 요구하고 major/minor feature hint를 pin된 `4.7.2` target과 비교한 뒤 identity-bound `EngineStatusReport`를 반환합니다. Executable observation 누락은 attention이고 unavailable, ambiguous, conflicting, major/minor-incompatible project는 blocking입니다. 공개 input에는 executable-path field가 없습니다. 이 명령은 host를 검색하거나 engine executable을 읽거나 process를 시작하거나 Editor에 연결하거나 support grade를 `planned`보다 높이지 않습니다.

`engine capabilities`도 `--engine godot`를 요구하고 선택한 project root만 받습니다. Exact static status 경계를 재사용한 뒤 compatible하고 모호하지 않은 Godot project identity 하나에 공통 operation contract 14개를 고정 순서로 반환합니다. 모든 operation은 `planned`와 `documented`이며 각 entry가 execution kind, component, limitation, degrade reason, permission, required evidence를 명시합니다. Report는 compiled containment-provider catalog의 provider가 0개이고 self-test를 실행하지 않았으며 launch를 사용할 수 없다는 점도 증명합니다. Executable을 탐지하거나 provider/launch input을 받거나 process를 실행하거나 Editor에 연결하거나 receipt를 만들거나 support grade를 승격하지 않습니다.

아홉 명령 모두 project state 초기화, profile/policy byte 생성, file repair, marker clear, recovery finalization 호출, software 설치, network access, Editor 제어를 수행하지 않습니다.

## 출력과 종료 계약

| Exit | 의미 |
| --- | --- |
| `0` | Plan이 `ready`이거나 진단이 `healthy` 또는 `attention`으로 완료 |
| `1` | Validated report를 만들기 전에 command 실패 |
| `2` | CLI 사용이 잘못됐거나 command가 구현되지 않음 |
| `3` | Validated report에 blocking finding 존재 |
| `4` | 취소된 command용 예약 값 |
| `5` | uncertain command outcome용 예약 값 |

Human/JSON mode는 같은 report status와 exit mapping을 사용합니다. `init` target conflict는 blocking이며 project를 변경하지 않습니다. 미초기화 project는 doctor의 attention 결과이며 write-free입니다. Unsafe root, unsupported runtime, corrupt managed state, surviving transaction marker는 blocking입니다. Static project inspection은 `ready`/`attention`에 exit `0`, `blocked`에 exit `3`을 반환하며 dynamic unknown을 clean, absent, verified claim으로 바꾸지 않습니다. Pack list는 stable bounded listing 또는 uninitialized state에 `0`, unavailable/incomplete/malformed/transaction-active state에 `3`을 반환합니다. Pack doctor는 `healthy`/`attention`에 `0`, unsafe state, drift, bound 초과, recovery-required transaction state에 `3`을 반환합니다. Skill list는 bound catalog에 `0`, unavailable project에 `3`을 반환합니다. Skill check는 missing target을 포함한 `ready`/`attention`에 `0`, conflict, unsafe path, byte overflow, unavailable project에 `3`을 반환합니다. Godot status는 명시적 attention gap이 남은 compatible project에 `0`, blocked project observation에 `3`을 반환합니다. Godot capabilities는 compatible identity-bound static catalog에만 `0`, identity를 확립할 수 없으면 `3`을 반환합니다. 어느 engine command도 availability를 engine support로 취급하지 않습니다.

## 남은 계획 명령군

- 실제 `init` mutation은 planned입니다. Plan을 다시 검증하고 exact project-metadata authority를 bind하며 staged compare-and-swap write를 사용해야 하고, engine이나 system tool은 계속 설치하지 않습니다.
- Mutating `pack add`, `pack update`, `pack remove`, recovery finalization과 `skill install`은 승인된 managed lifecycle을 재사용하며 설치 자체에서 authority를 만들지 않습니다. 현재 pack/skill inspection command는 read-only를 유지합니다.
- Live capability negotiation과 `engine connect`는 planned입니다. Available인 두 static Godot engine command는 live session이나 execution authority를 확립하지 않습니다.
- `run`과 `verify`는 registered bounded workflow를 실행하고 process, test, gameplay, capture, performance, build outcome을 분리합니다.
- `evidence export`는 external evidence movement의 유일한 계획 경로이며 explicit destination approval이 필요합니다.

## 공통 명령 계약

모든 구현 command는 input/output schema, capability, permission, side effect, execution lane, timeout, cancellation, retry mode, budget, evidence requirement, handler digest를 선언해야 합니다. 현재 아홉 command의 handler metadata는 각 compiled module을 attest하며 CI가 digest drift를 거부합니다. 현재 source-built MCP runtime은 pack inspection과 project-only Godot tool 두 개를 포함해 explicitly enabled read-only tool에 같은 command/schema identity를 유지하지만 CLI setup command나 installer는 아닙니다. Registry는 bounded capability-first skill 열한 개를 route하며 `project.inspection`만 `project.inspect`와, Godot observation이 적격할 때만 `engine.capabilities`로 route합니다. Shared skill runtime을 통해 CLI, MCP, Codex adapter가 열한 deterministic project target을 materialize하지 않고 list/inspect합니다. Task-routing contract는 한 번의 선택을 계속 skill 1~5개로 제한합니다. Mutating skill/host runtime도 같은 identity를 유지해야 하며 generated metadata만으로 해당 capability가 존재하는 것은 아닙니다.

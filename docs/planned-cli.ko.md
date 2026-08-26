---
source: docs/planned-cli.md
source_sha256: ea9c04f94130e56db4c41050f256702716edf97deb9d5ee4d83d9cef4994eae2
translated_at: 2026-08-27
---

# 명령줄 인터페이스 상태

> 상태: 일부 구현 상태입니다. Source-built `agpb` executable이 plan-only `agpb init`, read-only `agpb doctor`, static read-only `agpb project inspect`를 제공합니다. Published package는 없습니다.

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

[planned-surface.json](planned-surface.json)과 생성된 [foundation plan](../generated/foundation-plan.json)에서 available로 표시된 것은 `agpb init`, `agpb doctor`, `agpb project inspect`뿐입니다. 나머지 entry는 모두 planned입니다. Slash-command interface는 약속하지 않습니다.

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
```

`--project`는 absolute path 또는 현재 working directory 기준 relative path를 받습니다. 생략하면 각 명령이 현재 directory를 선택합니다. `--json`은 해당 명령의 등록된 report를 canonical JSON으로 출력하며 기본 모드는 safe next action이 포함된 간결한 human report입니다.

`init`은 write-plan-only입니다. 고정된 project-local target 16개를 `create`, `retain`, `conflict`로 분류합니다.

- commit 대상인 profile, policy, feature, pack lock, 내부 ignore policy target;
- local-only인 cache, evidence, log, screenshot, lock, local configuration, runtime state target.

현재 planner는 target path의 안전성과 filesystem kind만 검증합니다. `retain`은 기존 profile, lock, ignore-policy 내용이 유효하다는 증거가 아니며 content inspection과 mutation은 아직 계획 단계입니다.

Plan digest는 runtime registry, canonical project identity, 정렬된 target path, kind, policy, content intent, observation, conflict code를 결합합니다. 이는 진단 metadata이며 approval이나 apply authority가 아닙니다. Report는 항상 `mutationPerformed: false`와 `applySupported: false`를 명시하고 `--apply`를 잘못된 사용으로 거부합니다.

`doctor`는 다음을 bounded read-only 방식으로 검사합니다.

- runtime-registry와 generated-surface parity;
- 지원 Node.js 범위;
- canonical local project root 하나;
- 고정 runtime directory 8개;
- canonical installed-pack state;
- active 또는 malformed pack transaction marker.

`project inspect`는 다음을 bounded static 방식으로 검사합니다.

- canonical project root 하나와 deterministic root entry;
- multiple-candidate ambiguity를 포함한 complete/partial Godot, Unity, Unreal project marker;
- 최대 1 MiB인 BOM-free canonical schema-valid `.ai-game-playbook/profile.json`과 portable identity;
- profile engine/version과 탐지한 marker evidence의 compatibility;
- Git을 실행하지 않는 case-exact `.git` marker;
- PID, liveness, session, selection을 주장하지 않는 `Temp/UnityLockfile` 같은 static Editor signal.

Marker/profile 누락과 관찰하지 않은 dirty/process 상태는 attention finding입니다. Unavailable root, invalid/mismatched profile, engine ambiguity, bounded candidate report 초과는 blocking입니다. 이 명령은 static detection을 engine support로 보고하지 않고 stage evidence content를 검증하지 않으며 engine 실행, operating-system process 열거, Editor 연결, file write, network access를 수행하지 않습니다.

세 명령 모두 project state 초기화, profile/policy byte 생성, file repair, marker clear, recovery finalization 호출, software 설치, network access, Editor 제어를 수행하지 않습니다.

## 출력과 종료 계약

| Exit | 의미 |
| --- | --- |
| `0` | Plan이 `ready`이거나 진단이 `healthy` 또는 `attention`으로 완료 |
| `1` | Validated report를 만들기 전에 command 실패 |
| `2` | CLI 사용이 잘못됐거나 command가 구현되지 않음 |
| `3` | Validated report에 blocking finding 존재 |
| `4` | 취소된 command용 예약 값 |
| `5` | uncertain command outcome용 예약 값 |

Human/JSON mode는 같은 report status와 exit mapping을 사용합니다. `init` target conflict는 blocking이며 project를 변경하지 않습니다. 미초기화 project는 doctor의 attention 결과이며 write-free입니다. Unsafe root, unsupported runtime, corrupt managed state, surviving transaction marker는 blocking입니다. Static project inspection은 `ready`/`attention`에 exit `0`, `blocked`에 exit `3`을 반환하며 dynamic unknown을 clean, absent, verified claim으로 바꾸지 않습니다.

## 남은 계획 명령군

- 실제 `init` mutation은 planned입니다. Plan을 다시 검증하고 exact project-metadata authority를 bind하며 staged compare-and-swap write를 사용해야 하고, engine이나 system tool은 계속 설치하지 않습니다.
- `pack`과 `skill` mutation은 승인된 managed lifecycle을 재사용하며 설치 자체에서 authority를 만들지 않습니다.
- `engine` command는 exact project/editor session을 bind하고 capability degradation을 명시적으로 보고합니다.
- `run`과 `verify`는 registered bounded workflow를 실행하고 process, test, gameplay, capture, performance, build outcome을 분리합니다.
- `evidence export`는 external evidence movement의 유일한 계획 경로이며 explicit destination approval이 필요합니다.

## 공통 명령 계약

모든 구현 command는 input/output schema, capability, permission, side effect, execution lane, timeout, cancellation, retry mode, budget, evidence requirement, handler digest를 선언해야 합니다. `init`, `doctor`, `project inspect` handler metadata는 각 compiled module을 attest하며 CI가 digest drift를 거부합니다. 이후 MCP, skill, host runtime도 같은 command와 schema identity를 유지해야 하며 generated metadata만으로 해당 runtime이 존재하는 것은 아닙니다.

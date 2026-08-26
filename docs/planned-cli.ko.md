---
source: docs/planned-cli.md
source_sha256: 7f15b107ea33ce3ba099e0d22581c0de16e2c36476ed49034d6b7e9e767dae53
translated_at: 2026-08-26
---

# 명령줄 인터페이스 상태

> 상태: 일부 구현 상태입니다. Source-built `agpb` executable이 존재하지만 현재 available command는 read-only `agpb doctor` 하나뿐입니다. Published package는 없습니다.

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

[planned-surface.json](planned-surface.json)과 생성된 [foundation plan](../generated/foundation-plan.json)에서 available로 표시된 것은 `agpb doctor`뿐입니다. 나머지 entry는 모두 planned입니다. Slash-command interface는 약속하지 않습니다.

## 현재 사용 가능

Repository-local executable을 호출하기 전에 workspace를 build합니다.

```shell
pnpm build
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
```

`--project`는 absolute path 또는 현재 working directory 기준 relative path를 받습니다. 생략하면 현재 directory를 검사합니다. `--json`은 등록된 `DoctorReport`를 canonical JSON으로 출력하며 기본 모드는 safe next action이 포함된 간결한 human report입니다.

명령은 다음을 bounded read-only 방식으로 검사합니다.

- runtime-registry와 generated-surface parity;
- 지원 Node.js 범위;
- canonical local project root 하나;
- 고정 runtime directory 6개;
- canonical installed-pack state;
- active 또는 malformed pack transaction marker.

Project state 초기화, file repair, marker clear, recovery finalization 호출, software 설치, network access, Editor 제어는 수행하지 않습니다.

## 출력과 종료 계약

| Exit | 의미 |
| --- | --- |
| `0` | `healthy` 또는 `attention`으로 진단 완료, blocking finding 없음 |
| `1` | Validated report를 만들기 전에 command 실패 |
| `2` | CLI 사용이 잘못됐거나 command가 구현되지 않음 |
| `3` | Validated report에 blocking finding 존재 |
| `4` | 취소된 command용 예약 값 |
| `5` | uncertain command outcome용 예약 값 |

Human/JSON mode는 같은 report status와 exit mapping을 사용합니다. 미초기화 project는 attention이며 write-free입니다. Unsafe root, unsupported runtime, corrupt managed state, surviving transaction marker는 blocking입니다.

## 남은 계획 명령군

- `init`은 conflict 검사 뒤 project-local policy와 runtime state만 stage하며 engine이나 system tool을 설치하지 않습니다.
- `project inspect`는 engine marker, project identity, stage, target, budget, dirty state, instance ambiguity를 보고할 계획입니다.
- `pack`과 `skill` mutation은 승인된 managed lifecycle을 재사용하며 설치 자체에서 authority를 만들지 않습니다.
- `engine` command는 exact project/editor session을 bind하고 capability degradation을 명시적으로 보고합니다.
- `run`과 `verify`는 registered bounded workflow를 실행하고 process, test, gameplay, capture, performance, build outcome을 분리합니다.
- `evidence export`는 external evidence movement의 유일한 계획 경로이며 explicit destination approval이 필요합니다.

## 공통 명령 계약

모든 구현 command는 input/output schema, capability, permission, side effect, execution lane, timeout, cancellation, retry mode, budget, evidence requirement, handler digest를 선언해야 합니다. `doctor` handler metadata는 compiled module을 attest하며 CI가 digest drift를 거부합니다. 이후 CLI, MCP, 문서, host surface도 같은 command와 schema identity를 유지해야 합니다.

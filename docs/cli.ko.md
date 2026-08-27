---
source: docs/cli.md
source_sha256: 4a4782eafbeb5e2f6dde6069b0a395ac033a9dffddd79d28b850f62519d4f5d8
translated_at: 2026-08-28
---
# CLI 안내

> 상태: 소스 빌드에는 명령 9개가 있습니다. 현재 명령은 계획하거나 검사만 하며, 변경·워크플로·증거·실엔진 명령은 아직 계획 단계입니다.

[English](cli.md) · [문서 안내](README.ko.md)

## 소스에서 실행하기

`agpb`를 실행하기 전에 workspace를 빌드합니다.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm run agpb -- --help
```

프로젝트를 검사하는 명령에는 `--project <project-path>`를 사용합니다. 정규화된 JSON 출력이 필요하면 `--json`을 붙입니다.

## 현재 명령

| 명령 | 동작 |
| --- | --- |
| `agpb init` | 고정된 프로젝트 내부 구성을 계획하고 파일은 쓰지 않음 |
| `agpb doctor` | 런타임, 레지스트리, 프로젝트, 팩, 트랜잭션 상태 검사 |
| `agpb project inspect` | 정적 엔진 후보와 프로젝트 프로필 검사 |
| `agpb pack list` | 제한된 설치 팩 식별 정보와 개수 나열 |
| `agpb pack doctor` | 관리 소유권, 변형, 복구 상태 검사 |
| `agpb skill list` | 패키지 스킬 경로 12개 나열 |
| `agpb skill check` | 고정 스킬 대상을 누락·현재·충돌·위험으로 분류 |
| `agpb engine status` | Godot 프로젝트의 정적 호환성 검사 |
| `agpb engine capabilities` | 예정된 Godot 작업 계약과 현재 미충족 조건 표시 |

두 엔진 명령에는 `--engine godot`이 필요합니다. 실행 파일 경로를 받거나 Godot을 시작하지 않습니다. 에디터에도 연결하지 않으며 지원 등급을 `planned`보다 높이지 않습니다.

## 전체 명령 표면

전체 명령을 지금 실행할 수 있는 것과 아직 계획 중인 것으로 나눴습니다. 첫 번째 블록만 현재 CLI에 등록되어 있습니다.

### 현재 명령

```text available
agpb init
agpb doctor
agpb project inspect
agpb pack list
agpb pack doctor
agpb skill list
agpb skill check
agpb engine status
agpb engine capabilities
```

### 계획 단계

```text planned
agpb pack add
agpb pack update
agpb pack remove
agpb skill install
agpb engine connect
agpb run <workflow>
agpb verify
agpb evidence list
agpb evidence show
agpb evidence export
agpb docs check
```

명령 사용 가능 여부는 이 목록이 아니라 검증된 런타임 레지스트리에서 결정합니다. 생성된 상태 데이터와 CLI 도움말도 같은 레지스트리와 일치해야 합니다.

## 출력과 종료 코드

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 검증된 계획 또는 검사가 작업을 막는 문제 없이 끝남 |
| `1` | 검증된 보고서를 만들지 못함 |
| `2` | CLI 사용법이 잘못됐거나 명령을 구현하지 않음 |
| `3` | 검증된 보고서에 작업을 막는 문제가 있음 |
| `4` | 취소 결과에 예약 |
| `5` | 결과가 불확실한 경우에 예약 |

주의 진단의 종료 코드는 `0`일 수 있습니다. 초기화하지 않은 프로젝트, 선택 대상 누락, 동적 증거 확인 불가처럼 후속 확인은 필요해도 정적 보고서 자체가 유효한 경우입니다. JSON과 사람이 읽는 출력은 같은 상태·종료 코드 규칙을 사용합니다.

## 안전 경계

현재 공개 처리기는 변경 파일 수와 변경 바이트를 모두 0으로 선언합니다. 프로젝트 초기화, 팩·스킬 설치, 트랜잭션 복구, 엔진 실행, 에디터 제어, 네트워크 접근, 증거 내보내기를 할 수 없습니다.

알 수 없는 명령은 거부합니다. 생성된 설명자가 있어도 검증된 처리기가 없으면 실행할 수 없습니다.

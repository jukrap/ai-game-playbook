---
source: docs/planned-cli.md
source_sha256: 3370064935bd7b2fdc4df586484123fec8ba3cf76eeae8b849ad0bb45c134585
translated_at: 2026-08-26
---

# 계획된 명령줄 인터페이스

> 상태: 인터페이스 계획입니다. `agpb` 실행 파일은 아직 없으므로 현재 실행할 수 있는 명령은 없습니다.

[English](planned-cli.md) · [문서](README.ko.md)

## 명령군

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

slash command 인터페이스는 약속하지 않습니다. host integration이 자연어 또는 UI action을 canonical command ID로 연결할 수 있지만 공개 executable은 `agpb`입니다.

## Workspace와 project 설정

- `agpb init`은 엔진을 설치하거나 관련 없는 파일을 수정하지 않고 project-local policy와 profile 파일을 만들 계획입니다.
- `agpb doctor`는 control-plane 설치, managed path, dependency, local configuration을 검사할 계획입니다.
- `agpb project inspect`는 project를 변경하지 않고 engine metadata, project identity, development stage, target, budget, ambiguous state를 탐지할 계획입니다.

## Pack과 skill

- `agpb pack list|add|update|remove|doctor`는 staging, owned-path 검사, conflict detection, rollback, safe uninstall로 digest-pinned pack을 관리할 계획입니다.
- `agpb skill list|install|check`는 점진적으로 불러오는 workflow guidance를 제공할 계획입니다. skill 설치는 Editor, network, filesystem 권한을 부여하지 않습니다.

pack install, update, remove는 명시적 승인이 필요합니다. 사용자가 수정했거나 소유하지 않은 파일은 자동으로 덮어쓰거나 제거할 수 없습니다.

## 엔진 연결

- `agpb engine status`는 탐지한 project, process, session, support grade를 보여줄 계획입니다.
- `agpb engine capabilities`는 사용할 수 있는 operation과 명시적 degrade 사유를 협상할 계획입니다.
- `agpb engine connect`는 승인된 project/Editor session 하나를 결합할 계획입니다. instance가 모호하면 그럴듯한 대상을 선택하지 않고 중단합니다.

Editor control은 project/session별 한 번 승인이 필요합니다. Editor mutation command는 하나의 project lane에서 실행합니다.

## Workflow와 검증

- `agpb run <workflow>`는 feature contract 아래 등록되고 범위가 제한된 workflow를 실행할 계획입니다.
- `agpb verify`는 현재 contract에 필요한 compile/import, test, gameplay assertion, capture check, profile, build/export evidence를 실행할 계획입니다.

workflow repair는 3 cycle로 제한합니다. time, output, changed-file, changed-byte, external-cost budget을 강제합니다. 완료 상태를 알 수 없으면 `uncertain`을 반환하고 자동 retry를 끕니다.

## Evidence와 문서

- `agpb evidence list|show`는 local receipt와 artifact를 검사할 계획입니다.
- `agpb evidence export`는 evidence package를 project 경계 밖으로 보내는 유일한 계획 경로이며 항상 명시적 승인이 필요합니다.
- `agpb docs check`는 runtime registry가 존재한 뒤 생성 command 문서와 번역 public docs를 검증할 계획입니다.

## 공통 command 계약

모든 command는 input/output schema, capability, permission, side effect, execution lane, timeout, retry mode, budget, evidence requirement, handler digest를 선언할 계획입니다. outer process success와 inner operation success가 모두 통과해야 합니다. test 실행은 complete report와 0보다 큰 test count도 증명해야 합니다.

기계 판독 가능한 목록은 [planned-surface.json](planned-surface.json)에 있습니다. 의도한 표면을 설명할 뿐 실행 가능한 configuration이 아닙니다.

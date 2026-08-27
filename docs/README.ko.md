---
source: docs/README.md
source_sha256: be0e06eaf5369a2cf0906d1666ece1d1e50f38e2ad04b22685dcc95b72ccecbf
translated_at: 2026-08-27
---

# 문서

> 상태: 2026-08-27에 검토한 공개 설계 및 구현 상태 문서 묶음입니다. Control plane 기반과 source-built write-free CLI 명령 아홉 개를 구현하고 있습니다.

[English](README.md) · [프로젝트 소개](../README.ko.md)

## 독자와 목적

이 문서 묶음은 제품 경계와 현재 capability를 이해해야 하는 잠재 사용자, 기여자, 유지관리자를 위한 것입니다. 구현된 기반, source-built command, 계획된 runtime 동작, release 기능을 구분합니다.

## 문서 구성

| 문서 | 목적 |
| --- | --- |
| [상태와 범위](status-and-scope.ko.md) | 현재 저장소 상태, 초기 사용자, 포함 작업과 제외 범위 |
| [개념](concepts.ko.md) | 공통 lifecycle, 공개 type, support grade와 run outcome |
| [CLI 상태](planned-cli.ko.md) | 사용 가능한 `agpb init`, `agpb doctor`, `agpb project inspect`, `agpb skill list`, `agpb skill check`, static Godot `agpb engine status`와 `agpb engine capabilities` 동작 및 나머지 계획 명령군 |
| [아키텍처](architecture.ko.md) | Control plane, adapter, bridge, project state와 generated surface |
| [엔진 지원](engine-support.ko.md) | 공통 engine contract와 엔진별 검증 임계값 |
| [보안과 권한](security-and-permissions.ko.md) | 승인 class, stop condition, isolation과 data movement |
| [자산과 출처](assets-and-provenance.ko.md) | Placeholder-first asset lifecycle, 권리 metadata, QA와 provider |
| [증거와 검증](evidence-and-verification.ko.md) | Receipt, evidence grade, deterministic playtest와 golden task |
| [로드맵](roadmap.ko.md) | 구현 순서와 release 기준 |

[planned-surface.json](planned-surface.json)은 수동 관리하는 공개 상태 data입니다. 생성된 [foundation plan](../generated/foundation-plan.json)은 available/planned command를 분리하고 runtime-registry digest를 기록하는 digest 결합 projection입니다. 어느 파일도 executable configuration이 아니며 source-built CLI는 validated runtime registry를 직접 사용합니다.

## 상태 용어

- **Current**는 artifact가 저장소에 존재하고 검사할 수 있다는 뜻입니다.
- **Implemented foundation**은 code와 test가 있지만 사용자용 runtime capability를 의미하지 않습니다.
- **Available command**는 source-built executable이 해당 exact registry command를 dispatch한다는 뜻이며 published package나 engine 지원을 의미하지 않습니다.
- **Planned**는 사용 가능한 runtime capability가 아직 성립하지 않았다는 뜻입니다.
- **Detected**, **headless**, **editor-preview**, **verified**는 점점 강한 runtime evidence가 필요한 engine support grade입니다.
- Roadmap milestone은 availability를 의미하지 않습니다.

## 문서 경계

여기에는 오래 유지할 공개 설명, 현재와 계획 interface, 제한, 위험, 유지관리 규칙을 포함합니다. Private planning note, raw investigation record, local machine path, secret, log, capture, runtime evidence는 제외합니다.

## 유지관리

영어 문서가 원본입니다. 각 한국어 mirror는 영어 파일 경로, SHA-256 digest, 번역 기준일을 기록합니다. 공개 문서 변경은 두 언어를 같은 change에서 갱신하고 pair, digest, link, heading, code fence, command/type parity, runtime-registry drift, private-path leak 검사를 통과해야 합니다.

구현 상태, 공개 command, support grade, permission default, engine target, release scope가 바뀌면 이 문서 묶음을 검토합니다.

## 주의사항

- 이 제품의 live engine loop는 아직 검증하지 않았습니다.
- 각 adapter 구현 전에 exact engine patch를 pin합니다.
- 첫 release 전까지 package 이름과 공개 interface는 provisional입니다.
- 외부 code adoption이나 package publish 전에 project license를 선택해야 합니다.

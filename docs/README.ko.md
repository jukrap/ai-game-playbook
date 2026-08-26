---
source: docs/README.md
source_sha256: f2f0031fda0de3be7d7e000d22186f1461edd87e1f52d99c6f8fb11a65a03625
translated_at: 2026-08-26
---

# 문서

> 상태: 2026-08-26에 검토한 공개 설계 및 구현 상태 문서 묶음입니다. control plane 기반 구현을 진행하고 있습니다.

[English](README.md) · [프로젝트 소개](../README.ko.md)

## 독자와 목적

이 문서 묶음은 제품 경계와 현재 capability를 이해해야 하는 잠재 사용자, 기여자, 유지관리자를 위한 것입니다. 구현된 기반, 계획된 runtime 동작, 출시된 기능을 구분합니다.

## 문서 구성

| 문서 | 목적 |
| --- | --- |
| [상태와 범위](status-and-scope.ko.md) | 현재 저장소 상태, 초기 사용자, 포함 작업, 제외 범위 |
| [개념](concepts.ko.md) | 공통 생명주기, 공개 타입, 지원 등급, 실행 결과 |
| [계획된 CLI](planned-cli.ko.md) | 의도한 `agpb` 명령군과 실행 의미 |
| [아키텍처](architecture.ko.md) | control plane, adapter, bridge, 프로젝트 상태, 생성 표면 |
| [엔진 지원](engine-support.ko.md) | 공통 엔진 계약과 엔진별 검증 기준 |
| [보안과 권한](security-and-permissions.ko.md) | 승인 등급, 중단 조건, 격리, 데이터 이동 |
| [자산과 provenance](assets-and-provenance.ko.md) | placeholder 우선 자산 생명주기, 권리 metadata, QA, provider |
| [증거와 검증](evidence-and-verification.ko.md) | receipt, 증거 등급, 결정적 playtest, golden task |
| [로드맵](roadmap.ko.md) | 문서 승인, 구현 순서, release 기준 |

[planned-surface.json](planned-surface.json)은 수동으로 관리하는 공개 설계 데이터입니다. 생성된 [foundation plan](../generated/foundation-plan.json)은 typed registry의 digest 결합 projection입니다. 둘 다 설계 전용 산출물이며 runtime registry가 아니고 명령 호출에 사용할 수 없습니다.

## 상태 표현

- **Current**는 해당 산출물이 현재 저장소에 존재하고 검사할 수 있음을 뜻합니다.
- **Implemented foundation**은 코드와 테스트가 존재하지만 사용자용 runtime capability를 의미하지 않음을 뜻합니다.
- **Planned**는 사용 가능한 runtime capability가 확립되지 않았음을 뜻합니다.
- **Detected**, **headless**, **editor-preview**, **verified**는 점차 강한 runtime 증거를 요구하는 엔진 지원 등급입니다.
- 로드맵 milestone은 기능 제공을 의미하지 않습니다.

## 문서 경계

여기에는 지속해서 공개할 설명, 계획된 인터페이스, 제한, 위험, 유지보수 규칙이 포함됩니다. 비공개 계획 메모, 원시 조사 기록, 로컬 시스템 경로, 검토하지 않은 생성 결과, secret, log, capture, runtime 증거는 제외합니다.

## 유지보수

영어 파일이 원본입니다. 각 한국어 미러는 영어 파일 경로, SHA-256 digest, 번역 기준일을 기록합니다. 공개 문서 변경은 두 언어를 같은 변경에서 갱신하고 문서 쌍, digest, link, heading 구조, code fence, 계획된 command/type 정합성, 비공개 경로 누출 검사를 통과해야 합니다.

프로젝트 유지관리자가 이 문서 묶음을 관리합니다. 구현 상태, 공개 명령, 지원 등급, 기본 권한, 엔진 목표, release 범위가 바뀔 때 검토합니다. 더는 유효하지 않은 제품 주장은 현재 문서에서 갱신하고 과거 작업 기록은 공개 문서 밖에 둡니다.

## 주의 사항

- 이 제품으로 검증한 live engine loop는 아직 없습니다.
- 정확한 엔진 patch 버전은 각 adapter 구현을 시작하기 전에 pin합니다.
- package 이름과 공개 인터페이스는 첫 release 전까지 바뀔 수 있습니다.
- 외부 코드 채택이나 package publish 전에 프로젝트 라이선스를 선택해야 합니다.

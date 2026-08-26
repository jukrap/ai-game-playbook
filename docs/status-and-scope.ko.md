---
source: docs/status-and-scope.md
source_sha256: fd235e52ad01452bf3aed7ad65046ad614488f034d48803923e2f4a4d4376ed6
translated_at: 2026-08-26
---

# 현재 상태와 범위

> 상태: 2026-08-26에 검토한 Stage 1 control plane 기반 구현 단계입니다.

[English](status-and-scope.md) · [문서](README.ko.md)

## 현재 저장소 상태

현재 저장소에는 private pnpm/TypeScript workspace, versioned contract schema, semantic validator, typed registry 검증 및 projection, digest 결합 foundation plan, test, Windows/Linux CI 설정이 있습니다.

설치 가능한 package, `agpb` 실행 파일, MCP server runtime, Codex integration 파일, permission 또는 workflow runtime, engine bridge, engine pack, 실행 가능한 golden project는 아직 없습니다. [planned-surface.json](planned-surface.json)의 명령 목록과 생성된 [foundation plan](../generated/foundation-plan.json)은 설계 전용이며 어느 command 또는 engine capability도 `planned`보다 높이지 않습니다.

## 대상 사용자와 첫 결과물

주요 사용자는 개인 또는 1~5인 개발팀입니다. 첫 완성 결과물은 movement, camera, collision, collectible, HUD counter, save/load, restart, win state를 갖춘 Windows x64용 오프라인 싱글플레이 3D vertical slice입니다.

첫 alpha는 폭넓은 장르 지원, 완성도 높은 콘텐츠 생성, 장시간 자율 개발보다 안정적인 graybox 제작과 검증을 우선합니다.

## First-party 엔진 범위

| 엔진 | 현재 등급 | 초기 구현 방향 | 계획 버전군 |
| --- | --- | --- | --- |
| Godot | `planned` | 첫 adapter와 완전한 graybox loop | 4.7.x |
| Unity | `planned` | 두 번째 adapter, 공식 자동화 경로 우선 | 6.3 LTS |
| Unreal Engine | `planned` | 세 번째 adapter, Editor와 build 경로 분리 | 5.8.x |

버전군은 날짜가 있는 계획 목표이지 테스트된 호환성 주장이 아닙니다. 구현을 시작하기 전에 exact patch와 필수 module을 다시 탐지하고 pin합니다.

## 첫 alpha에 포함

- 프로젝트 탐지와 identity, stage, target, budget 검사.
- 범위가 제한된 feature workflow와 명시적 완료 계약.
- compare-and-swap 검사와 rollback을 포함한 안전한 source 및 Editor mutation.
- compile/import, 0건이 아닌 test 실행, runtime play, 결정적 입력, state assertion, log, capture, profile, build/export receipt.
- typed placeholder와 provenance·QA를 갖춘 사용자 제공 또는 licensed asset.
- 로컬 evidence 저장과 명시적 evidence export.
- Windows x64 첫 build target과 지원 가능한 Linux static/headless CI.

## 연기 또는 선택 사항

- 로컬 Blender와 image/ML tool은 선택 사항이며 자동 설치하지 않습니다.
- hosted image-provider pack은 최대 하나만 활성화할 수 있고 설치 및 각 외부·유료 호출을 따로 승인합니다.
- 3D와 audio generation은 후속 pack입니다.
- UI reconstruction과 balance simulation은 핵심 엔진 loop 이후입니다.
- dashboard, desktop UI, macOS 검증은 후속 milestone입니다.

## 첫 alpha 범위 밖

- browser-first 게임 프레임워크와 추가 엔진의 first-party 지원.
- multiplayer와 online service orchestration.
- mobile, console, XR, web export target.
- cinematic 또는 video generation.
- engine, Editor, Blender, system-wide tool 자동 설치.
- 자동 publish, release, store submission, 원격 evidence upload.

## 준비 조건

7개 문서 gate를 모두 승인한 뒤 Stage 1 구현을 시작했습니다. `0.1.0-alpha`는 여전히 Godot golden loop 전체가 end-to-end로 통과해야 합니다. `1.0`은 세 엔진이 모두 `verified`에 도달하고 설치 생명주기, 복구, behavior evaluation이 안정화되어야 합니다.

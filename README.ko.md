---
source: README.md
source_sha256: e406e07d16e4c399e011ac65d6139a2e3721a508f768ca40710ecc63c7bb8738
translated_at: 2026-08-26
---

# AI Game Playbook

> 상태: control plane 계약, registry, 초기 core filesystem/process/project-lane/permission-admission 경계를 구현하는 단계입니다. 설치 가능한 패키지, `agpb` 실행 파일, MCP 서버, 엔진 어댑터는 아직 없습니다.

[English](README.md)

AI Game Playbook은 Godot, Unity 또는 Unreal Engine으로 게임을 만드는 소규모 팀을 위한 AI 보조 게임 개발 하네스입니다. 코드 생성만이 아니라 범위가 제한된 워크플로, 명시적 권한, 재현 가능한 증거, 실제 엔진 동작을 중심으로 설계하고 있습니다.

## 현재 존재하는 것

- versioned 공개 schema와 semantic validation을 포함한 pnpm/TypeScript workspace.
- command, skill, workflow, role lens, schema, pack descriptor를 검증하고 범위가 제한된 설계 projection을 생성하는 typed registry.
- canonical project root 결합, portable path 해석, staged SHA-256 compare-and-swap 쓰기, digest 결합 direct process 실행, 초기화된 project마다 root/project에 결합된 mutating lease 하나, registry 결합 permission admission과 서명된 scoped grant를 제공하는 초기 private core package.
- 의도한 command 및 skill surface를 담은 digest 결합 추적 계획.
- 영어 문서와 한국어 미러.
- contract, 생성 계획 drift, 문서 정합성을 검사하는 cross-platform static check.

이 기반은 개발용 library와 검사이며 사용 가능한 제품이 아닙니다. lane primitive는 미리 생성된 local project state와 명시적 갱신이 필요하고 아직 parallel reader를 조정하거나 Editor를 제어하지 않습니다. permission primitive는 실제 등록 command input, project/feature/workflow/session scope, 실행 budget, Ed25519 grant, use count, 보고된 effect를 검증하지만 in-memory이고 dispatcher, approval UI, durable checkpoint, recovery flow에 연결되지 않았습니다. CPU와 memory sandbox도 아직 없습니다. 현재 저장소는 설치 가능한 npm 패키지나 동작하는 게임 엔진 자동화를 제공하지 않습니다. 문서의 명령은 인터페이스 계획이며 지금 실행할 수 있는 명령이 아닙니다.

## 제품 방향

첫 제품 목표는 개인 또는 최대 5인 팀이 만드는 Windows x64용 오프라인 싱글플레이 3D vertical slice입니다. 의도한 흐름은 다음과 같습니다.

1. 프로젝트를 검사하고 사용 가능한 엔진 capability를 협상합니다.
2. 범위가 제한된 feature contract와 권한 예산을 정의합니다.
3. 프로젝트 단위 실행 lane 하나에서 소스 또는 Editor 상태를 변경합니다.
4. compile/import, test, play, 결정적 입력 재생, 실제 runtime 증거 캡처를 수행합니다.
5. build/export하고 receipt를 기록하며 필요하면 안전하게 rollback합니다.

Godot, Unity, Unreal Engine만 계획된 first-party 엔진입니다. 웹 게임 프레임워크, 멀티플레이어, 모바일, 콘솔, XR, macOS 검증은 첫 alpha 범위 밖입니다.

## 설계 약속

- 하나의 typed registry가 command 및 skill descriptor를 정의하고 현재 설계 projection을 생성합니다. 향후 CLI, MCP, 도움말, host integration도 동일하게 검증된 authority metadata를 사용해야 합니다.
- 지원하지 않는 capability는 명시적으로 degrade해야 하며 낮은 등급의 증거를 `verified`로 표시할 수 없습니다.
- Editor mutation은 프로젝트별로 직렬화하며 identity 또는 dirty file 상태가 모호해지면 중단합니다.
- 설치, 네트워크, 외부 전송, 유료 호출, 파괴 작업, publish에는 별도 승인이 필요합니다.
- telemetry는 계획하지 않습니다. 증거는 명시적인 export 작업을 통해서만 로컬 프로젝트 밖으로 나갑니다.
- 엔진과 콘텐츠 제작 애플리케이션은 탐지하지만 자동 설치하지 않습니다.

## 설계 문서 읽기

- [문서 색인](docs/README.ko.md)
- [현재 상태와 범위](docs/status-and-scope.ko.md)
- [핵심 개념과 공개 타입](docs/concepts.ko.md)
- [계획된 명령줄 인터페이스](docs/planned-cli.ko.md)
- [목표 아키텍처](docs/architecture.ko.md)
- [엔진 지원 모델](docs/engine-support.ko.md)
- [보안과 권한](docs/security-and-permissions.ko.md)
- [자산과 provenance](docs/assets-and-provenance.ko.md)
- [증거와 검증](docs/evidence-and-verification.ko.md)
- [로드맵](docs/roadmap.ko.md)

## 설치

아직 설치할 수 없습니다. 이 프로젝트로 생각하고 비슷한 이름의 패키지를 설치하지 마세요. 문서 게이트가 승인되고 실제 패키지가 clean install, update, rollback, conflict, uninstall 테스트를 통과한 뒤에만 설치 안내를 추가합니다.

## 프로젝트 상태와 라이선스

구현 과정에서 인터페이스가 바뀔 수 있습니다. 프로젝트 라이선스는 아직 선택하지 않았으므로 라이선스 파일이 추가되기 전에는 재배포 권리를 가정하지 마세요. 이 결정 전에는 release나 package publish를 진행하지 않습니다.

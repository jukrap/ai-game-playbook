---
source: docs/assets-and-provenance.md
source_sha256: 86e0a5cbd41579ab8b379094e98730a837eb9b7ed35e0cf83f25cf9674484f10
translated_at: 2026-08-26
---

# 자산과 Provenance

> 상태: 등록된 provenance contract와 제한된 private assessment가 있는 계획된 자산 정책입니다. Asset pipeline이나 provider integration은 아직 없습니다.

[English](assets-and-provenance.md) · [문서](README.ko.md)

## 기본 생명주기

계획된 production 경로는 다음과 같습니다.

`typed placeholder → user/licensed asset → candidate → QA → approved → production`

모든 gameplay 또는 UI asset은 purpose, 예상 dimension 또는 scale, format, collision/interaction 필요, performance budget, fallback behavior를 가진 typed slot에서 시작합니다. candidate가 slot을 만족함을 증명할 때까지 placeholder는 유효합니다.

download, conversion, generation이 성공했다는 이유만으로 file이 production-ready가 되지 않습니다.

## `AssetProvenance`

등록된 contract는 다음 candidate metadata를 담을 수 있으며 production-pipeline integration은 계획 단계입니다.

- 안정적인 asset과 slot identity.
- original source category, lineage, source file hash.
- 선언한 license 또는 rights status와 attribution obligation.
- transformation step, tool version, input hash, output hash.
- generation 사용 시 provider, model, checkpoint, prompt digest, seed, setting.
- estimated/actual cost, external-transmission approval, reviewer approval.
- engine import setting, dependency, QA result, promotion state, rollback target.

권리를 알 수 없거나 lineage가 없으면 production 승격을 차단합니다. 시스템은 file을 사용할 수 있다는 사실로 ownership을 추론하지 않습니다.

현재 private assessor는 `AssetProvenance` 값을 exact in-process registry에 대해 검증하고 semantic invariant를 확인하며 선언된 current-file path, SHA-256 digest, byte count 하나가 평가한 artifact와 일치하도록 요구합니다. Bounded identity, lifecycle, QA count, rights summary, issue-code metadata를 반환합니다. 이 검사를 통과해도 권리를 승인하거나 asset을 import하거나 lifecycle을 진행하거나 engine-backed QA를 확립하거나 production-ready로 만들지 않으며 결과도 아직 영속화하지 않습니다.

## 첫 버전 지원 입력

첫 버전은 deterministic placeholder와 user-provided 또는 licensed asset을 완전히 지원할 계획입니다. placeholder는 engine-native이고 재현 가능하며 다시 만들기 저렴하고 역할별로 시각 구분되며 gameplay test에 적합해야 합니다.

선택적 local Blender, image, ML tool은 사용자가 탐지하고 설정할 수 있지만 자동 설치하지 않습니다. 출력은 같은 candidate, provenance, QA, approval 경로를 따릅니다.

## Hosted provider 경계

hosted provider는 기본 disabled입니다. 첫 버전에는 image-provider pack 최대 하나를 활성화할 수 있습니다. 각 호출 전에 destination, transmitted data, provider/model, expected cost, rights assumption, retention caveat를 보여주고 승인받아야 합니다.

provider pack 설치는 이후 network access를 승인하지 않습니다. response는 content, dimension, format, rights metadata, file hash, engine import를 검사할 때까지 candidate로 격리합니다.

3D와 audio generation은 후속 pack으로 연기합니다. cinematic과 video generation은 첫 버전 범위 밖입니다.

## QA와 승격

asset QA는 type별로 수행하고 필요한 경우 engine-backed입니다. dimension, color space, alpha, compression, mesh topology, scale, pivot, UV, material, animation, collision, memory, import warning, visual state coverage, runtime performance를 포함할 수 있습니다.

promotion은 staged operation입니다. candidate 검증, approval 기록, stable binding 갱신, import/compile, 영향받는 gameplay/UI 검사, evidence capture, rollback path 보존을 수행합니다. 가능하면 실패해도 기존 production asset을 바꾸지 않습니다.

## UI 자산

HUD와 menu asset은 stable element/asset ID, parent-relative hierarchy, safe-area behavior, 적합한 atlas 또는 nine-slice rule을 사용합니다. viewport, state, input modality, locale 조합에서 visual similarity, interaction/focus, gameplay-state binding을 따로 평가합니다.

rendered frame은 editable hierarchy, interaction, accessibility, gameplay binding이 옳다는 증거가 아닙니다. receipt는 editable source, imported asset, scene hierarchy, runtime state, capture를 hash로 연결합니다.

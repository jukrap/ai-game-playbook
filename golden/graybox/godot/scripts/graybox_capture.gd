extends RefCounted

const OUTPUT_PREFIX := "AGPB_RUNTIME_FRAME "
const SCENARIO_DIGEST := "sha256:4bce945905093f746939b6b8f1c6183d0795f2f74b533763970aeed5be4e6c0f"
const CAMERA_ID := "camera.follow"
const EXPECTED_RENDERER := "gl_compatibility"
const EXPECTED_ENGINE_VERSION := "4.7.2"
const EXPECTED_ENGINE_STATUS := "stable"
const EXPECTED_WIDTH := 960
const EXPECTED_HEIGHT := 540
const MAX_ARTIFACT_BYTES := 4 * 1024 * 1024

var _game
var _artifact_path := ""
var _input_binding_digest := ""
var _run_id := ""
var _scenario_id := ""
var _scene_id := ""
var _seed := ""
var _terminal_state_digest := ""
var _ready := false
var _finished := false


func _init(game, scenario: Dictionary, arguments: PackedStringArray) -> void:
	_game = game
	if not _parse_arguments(arguments):
		return
	_scenario_id = String(scenario.get("scenarioId", ""))
	var initial_state: Dictionary = scenario.get("initialState", {})
	_scene_id = String(initial_state.get("sceneId", ""))
	_seed = String(initial_state.get("seed", ""))
	if (
		_scenario_id != "scenario.graybox.core"
		or _scene_id != "scene.graybox.main"
		or _seed != "graybox-core-v1"
	):
		return
	_ready = true
	_emit("capture-started", {
		"runId": _run_id,
		"scenarioId": _scenario_id,
		"scenarioDigest": SCENARIO_DIGEST,
		"seed": _seed,
		"inputBindingDigest": _input_binding_digest,
		"sceneId": _scene_id,
		"cameraId": CAMERA_ID,
	})


func is_ready() -> bool:
	return _ready


func emit_replay_event(event: String, details: Dictionary) -> void:
	if not _ready or _finished:
		return
	if event == "replay-started":
		return
	if event == "oracle-passed" and bool(details.get("terminal", false)):
		_terminal_state_digest = String(details.get("stateHash", ""))
	_emit(event, details)


func complete_replay(tick: int) -> void:
	if not _ready or _finished:
		return
	if not _is_digest(_terminal_state_digest):
		_fail("terminal-state-unavailable", tick)
		return
	_game.freeze_runtime_frame()
	_capture_after_draw(tick)


func _capture_after_draw(tick: int) -> void:
	await RenderingServer.frame_post_draw
	if _finished:
		return
	var display_server := DisplayServer.get_name()
	if display_server == "headless" or display_server.is_empty():
		_fail("display-unavailable", tick)
		return
	var renderer := RenderingServer.get_current_rendering_method()
	var rendering_driver := RenderingServer.get_current_rendering_driver_name()
	if renderer != EXPECTED_RENDERER or rendering_driver.is_empty() or rendering_driver.length() > 64:
		_fail("renderer-invalid", tick)
		return
	var version: Dictionary = Engine.get_version_info()
	var engine_version := "%d.%d.%d" % [
		int(version.get("major", -1)),
		int(version.get("minor", -1)),
		int(version.get("patch", -1)),
	]
	var engine_status := String(version.get("status", ""))
	if engine_version != EXPECTED_ENGINE_VERSION or engine_status != EXPECTED_ENGINE_STATUS:
		_fail("engine-identity-invalid", tick)
		return
	var image := _game.get_viewport().get_texture().get_image()
	if image == null or image.is_empty():
		_fail("image-unavailable", tick)
		return
	if image.get_width() != EXPECTED_WIDTH or image.get_height() != EXPECTED_HEIGHT:
		_fail("viewport-invalid", tick)
		return
	image.convert(Image.FORMAT_RGBA8)
	if image.save_png(_artifact_path) != OK:
		_fail("png-save-failed", tick)
		return
	var file := FileAccess.open(_artifact_path, FileAccess.READ)
	if file == null:
		_fail("artifact-unavailable", tick)
		return
	var artifact_bytes := file.get_length()
	file = null
	var artifact_hash := FileAccess.get_sha256(_artifact_path)
	var artifact_digest := "sha256:%s" % artifact_hash
	if (
		artifact_bytes < 8
		or artifact_bytes > MAX_ARTIFACT_BYTES
		or not _is_digest(artifact_digest)
	):
		_fail("artifact-identity-invalid", tick)
		return
	_finished = true
	_emit("capture-passed", {
		"runId": _run_id,
		"tick": tick,
		"scenarioDigest": SCENARIO_DIGEST,
		"stateDigest": _terminal_state_digest,
		"inputBindingDigest": _input_binding_digest,
		"sceneId": _scene_id,
		"cameraId": CAMERA_ID,
		"renderer": renderer,
		"renderingDriver": rendering_driver,
		"displayServer": display_server,
		"engineVersion": engine_version,
		"engineStatus": engine_status,
		"viewport": {
			"width": image.get_width(),
			"height": image.get_height(),
			"scale": "1.000000",
		},
		"artifactDigest": artifact_digest,
		"artifactBytes": artifact_bytes,
	})
	_game.finish_replay(0)


func _parse_arguments(arguments: PackedStringArray) -> bool:
	if (
		arguments.size() != 7
		or arguments[0] != "--agpb-runtime-frame"
		or arguments[1] != "--agpb-run-id"
		or arguments[3] != "--agpb-input-binding"
		or arguments[5] != "--agpb-artifact"
	):
		return false
	_run_id = arguments[2]
	_input_binding_digest = arguments[4]
	_artifact_path = arguments[6]
	return (
		_is_uuid(_run_id)
		and _is_digest(_input_binding_digest)
		and _artifact_path.is_absolute_path()
		and not _artifact_path.begins_with("res://")
		and not _artifact_path.begins_with("user://")
		and _artifact_path.get_file() == "runtime-frame.png"
	)


func _is_uuid(value: String) -> bool:
	if value.length() != 36:
		return false
	for index in range(value.length()):
		var character := value.substr(index, 1)
		if index in [8, 13, 18, 23]:
			if character != "-":
				return false
		elif not "0123456789abcdef".contains(character):
			return false
	return (
		"12345678".contains(value.substr(14, 1))
		and "89ab".contains(value.substr(19, 1))
	)


func _is_digest(value: String) -> bool:
	if value.length() != 71 or not value.begins_with("sha256:"):
		return false
	for index in range(7, value.length()):
		if not "0123456789abcdef".contains(value.substr(index, 1)):
			return false
	return true


func _fail(code: String, tick: int) -> void:
	if _finished:
		return
	_finished = true
	_emit("capture-failed", {
		"runId": _run_id,
		"code": code,
		"tick": tick,
		"scenarioDigest": SCENARIO_DIGEST,
	})
	_game.finish_replay(2)


func _emit(event: String, details: Dictionary) -> void:
	var output := {"event": event}
	for key in details:
		output[key] = details[key]
	print(OUTPUT_PREFIX + JSON.stringify(output))

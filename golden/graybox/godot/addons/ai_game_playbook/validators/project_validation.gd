extends SceneTree

const OUTPUT_PREFIX := "AGPB_PROJECT_VALIDATION "
const MANIFEST_PATH := "res://manifest.json"
const UNKNOWN_PROJECT_ID := "unknown.project"
const UNKNOWN_SOURCE_DIGEST := "sha256:0000000000000000000000000000000000000000000000000000000000000000"
const UNKNOWN_MAIN_SCENE := "unknown.tscn"

var _project_id := UNKNOWN_PROJECT_ID
var _source_digest := UNKNOWN_SOURCE_DIGEST
var _main_scene := UNKNOWN_MAIN_SCENE
var _started := false
var _finished := false


func _initialize() -> void:
	call_deferred("_run_validation")


func _run_validation() -> void:
	if not FileAccess.file_exists(MANIFEST_PATH):
		_fail("manifest-missing")
		return
	var manifest_text := FileAccess.get_file_as_string(MANIFEST_PATH)
	var parsed: Variant = JSON.parse_string(manifest_text)
	if typeof(parsed) != TYPE_DICTIONARY:
		_fail("manifest-invalid")
		return
	var manifest: Dictionary = parsed
	_project_id = String(manifest.get("projectId", ""))
	_source_digest = String(manifest.get("sourceDigest", ""))
	_main_scene = String(manifest.get("mainScene", ""))
	if not _valid_project_id(_project_id) or not _valid_digest(_source_digest):
		_fail("manifest-invalid")
		return
	if not _valid_portable_path(_main_scene):
		_fail("main-scene-path-invalid")
		return
	_emit_started()
	var resource_path := "res://%s" % _main_scene
	if String(ProjectSettings.get_setting("application/run/main_scene", "")) != resource_path:
		_fail("project-identity-mismatch")
		return
	if not ResourceLoader.exists(resource_path):
		_fail("main-scene-missing")
		return
	var resource: Resource = ResourceLoader.load(
		resource_path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE
	)
	if resource == null:
		_fail("main-scene-load-failed")
		return
	if not (resource is PackedScene):
		_fail("main-scene-not-packed")
		return
	var scene: PackedScene = resource
	var instance := scene.instantiate()
	if instance == null:
		_fail("main-scene-instantiate-failed")
		return
	var root_type := instance.get_class()
	instance.free()
	_emit("validation-passed", {
		"projectId": _project_id,
		"sourceDigest": _source_digest,
		"mainScene": _main_scene,
		"resourceType": "PackedScene",
		"rootType": root_type,
	})
	_finished = true
	quit(0)


func _emit_started() -> void:
	if _started:
		return
	_started = true
	_emit("validation-started", {
		"projectId": _project_id,
		"sourceDigest": _source_digest,
		"mainScene": _main_scene,
	})


func _fail(code: String) -> void:
	if _finished:
		return
	_emit_started()
	_finished = true
	_emit("validation-failed", {
		"projectId": _project_id,
		"sourceDigest": _source_digest,
		"mainScene": _main_scene,
		"code": code,
	})
	quit(2)


func _emit(event: String, details: Dictionary) -> void:
	var payload := {"event": event}
	for key in details:
		payload[key] = details[key]
	print(OUTPUT_PREFIX + JSON.stringify(payload))


func _valid_project_id(value: String) -> bool:
	if value.is_empty() or value.length() > 128:
		return false
	var first := value.unicode_at(0)
	if first < 97 or first > 122:
		return false
	for index in range(value.length()):
		var character := value.unicode_at(index)
		var lower_alpha := character >= 97 and character <= 122
		var digit := character >= 48 and character <= 57
		if not lower_alpha and not digit and character != 45 and character != 46:
			return false
	return true


func _valid_digest(value: String) -> bool:
	if value.length() != 71 or not value.begins_with("sha256:"):
		return false
	for index in range(7, value.length()):
		var character := value.unicode_at(index)
		var digit := character >= 48 and character <= 57
		var lower_hex := character >= 97 and character <= 102
		if not digit and not lower_hex:
			return false
	return true


func _valid_portable_path(value: String) -> bool:
	if value.is_empty() or value.length() > 512:
		return false
	if value.begins_with("/") or value.ends_with("/") or value.contains("\\"):
		return false
	if value.contains("//"):
		return false
	for segment in value.split("/"):
		if segment.is_empty() or segment == "." or segment == "..":
			return false
	return true

extends Node3D

const GrayboxReplay = preload("res://scripts/graybox_replay.gd")
const GrayboxPersistence = preload("res://scripts/graybox_persistence.gd")
const GrayboxCapture = preload("res://scripts/graybox_capture.gd")

const START_POSITION := Vector3(0.0, 1.0, 4.0)
const MOVE_SPEED := 4.0
const PLAYER_RADIUS := 0.5
const WALL_PLANE_X := 4.0
const INTERACTION_DISTANCE := 1.25
const SAVE_PATH := "user://graybox-save.json"
const COLLECTIBLE_ORDER := ["first", "second"]

var _player: CharacterBody3D
var _camera: Camera3D
var _hud_label: Label
var _held_actions: Dictionary = {}
var _collectibles: Dictionary = {}
var _collected: Dictionary = {}
var _score := 0
var _won := false
var _blocked_path_held := false
var _camera_yaw := 0.0
var _tick := 0
var _replay_mode := false
var _replay_finished := false
var _replay_runner
var _capture_mode := false
var _capture_runner
var _persistence_mode := ""
var _persistence_finished := false


func _ready() -> void:
	_build_world()
	reset_fresh_profile()
	var scenario := _load_scenario()
	if scenario.is_empty():
		push_error("Graybox scenario could not be loaded.")
		get_tree().quit(2)
		return
	var user_arguments := OS.get_cmdline_user_args()
	_capture_mode = "--agpb-runtime-frame" in user_arguments
	_replay_mode = "--agpb-replay" in user_arguments or _capture_mode
	if "--agpb-persistence-save" in user_arguments:
		_persistence_mode = "save"
	elif "--agpb-persistence-load" in user_arguments:
		_persistence_mode = "load"
	if not _persistence_mode.is_empty():
		_update_hud()
		GrayboxPersistence.new(self).run(_persistence_mode)
		return
	if _replay_mode:
		if _capture_mode:
			_capture_runner = GrayboxCapture.new(self, scenario, user_arguments)
			if not _capture_runner.is_ready():
				finish_replay(2)
				return
			_replay_runner = GrayboxReplay.new(
				self,
				scenario,
				Callable(_capture_runner, "emit_replay_event"),
				Callable(_capture_runner, "complete_replay")
			)
		else:
			_replay_runner = GrayboxReplay.new(self, scenario)
	elif DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_update_hud()


func _physics_process(delta: float) -> void:
	_tick += 1
	if _replay_runner != null:
		_replay_runner.before_tick(_tick)
	_update_player(delta)
	_update_camera()
	if _replay_runner != null:
		_replay_runner.after_tick(_tick)


func _unhandled_input(event: InputEvent) -> void:
	if _replay_mode or not _persistence_mode.is_empty():
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_camera_yaw += event.relative.x * 0.0025
		return
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	match event.keycode:
		KEY_E:
			_interact()
		KEY_F5:
			save_game()
		KEY_F9:
			load_game()
		KEY_ESCAPE:
			Input.mouse_mode = (
				Input.MOUSE_MODE_VISIBLE
				if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
				else Input.MOUSE_MODE_CAPTURED
			)


func _build_world() -> void:
	_add_static_box("Floor", Vector3(0.0, -0.5, -2.0), Vector3(18.0, 1.0, 22.0), Color("697565"))
	_add_static_box("Wall", Vector3(4.5, 1.5, -2.0), Vector3(1.0, 3.0, 18.0), Color("765b58"))
	_add_static_box("Backstop", Vector3(0.0, 1.0, -9.5), Vector3(9.0, 2.0, 1.0), Color("59636f"))

	var light := DirectionalLight3D.new()
	light.name = "KeyLight"
	light.rotation_degrees = Vector3(-55.0, -25.0, 0.0)
	light.shadow_enabled = true
	add_child(light)

	_player = CharacterBody3D.new()
	_player.name = "Player"
	_player.position = START_POSITION
	var player_shape := CollisionShape3D.new()
	var capsule_shape := CapsuleShape3D.new()
	capsule_shape.radius = PLAYER_RADIUS
	capsule_shape.height = 1.8
	player_shape.shape = capsule_shape
	_player.add_child(player_shape)
	var player_visual := MeshInstance3D.new()
	var capsule_mesh := CapsuleMesh.new()
	capsule_mesh.radius = PLAYER_RADIUS
	capsule_mesh.height = 1.8
	capsule_mesh.material = _material(Color("4ca6ff"))
	player_visual.mesh = capsule_mesh
	_player.add_child(player_visual)
	add_child(_player)

	_camera = Camera3D.new()
	_camera.name = "FollowCamera"
	_camera.current = true
	add_child(_camera)

	_add_collectible("first", Vector3(3.25, 0.75, 0.0), Color("ffcc4c"))
	_add_collectible("second", Vector3(3.25, 0.75, -8.0), Color("ff7a59"))
	_build_hud()
	_update_camera()


func _build_hud() -> void:
	var layer := CanvasLayer.new()
	layer.name = "HUD"
	_hud_label = Label.new()
	_hud_label.name = "CollectibleCount"
	_hud_label.position = Vector2(24.0, 20.0)
	_hud_label.add_theme_font_size_override("font_size", 24)
	layer.add_child(_hud_label)
	add_child(layer)


func _add_static_box(node_name: String, center: Vector3, size: Vector3, color: Color) -> void:
	var body := StaticBody3D.new()
	body.name = node_name
	body.position = center
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	var visual := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = _material(color)
	visual.mesh = mesh
	body.add_child(visual)
	add_child(body)


func _add_collectible(collectible_id: String, position_value: Vector3, color: Color) -> void:
	var area := Area3D.new()
	area.name = "Collectible_%s" % collectible_id
	area.position = position_value
	area.collision_layer = 2
	area.collision_mask = 0
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = 0.45
	collision.shape = shape
	area.add_child(collision)
	var visual := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.35
	mesh.height = 0.7
	mesh.material = _material(color)
	visual.mesh = mesh
	area.add_child(visual)
	add_child(area)
	_collectibles[collectible_id] = {
		"area": area,
		"collision": collision,
		"visual": visual,
	}


func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.85
	return material


func _update_player(delta: float) -> void:
	var direction := _movement_direction()
	if direction.length_squared() > 1.0:
		direction = direction.normalized()
	_player.velocity.x = direction.x * MOVE_SPEED
	_player.velocity.z = direction.z * MOVE_SPEED
	if not _player.is_on_floor():
		var gravity := float(ProjectSettings.get_setting("physics/3d/default_gravity", 9.8))
		_player.velocity.y -= gravity * delta
	else:
		_player.velocity.y = 0.0
	_player.move_and_slide()
	if direction.x > 0.0 and _player.global_position.x >= WALL_PLANE_X - PLAYER_RADIUS - 0.06:
		_blocked_path_held = true


func _movement_direction() -> Vector3:
	if _replay_mode:
		return Vector3(
			_action_axis("move.left", "move.right"),
			0.0,
			_action_axis("move.forward", "move.backward")
		)
	return Vector3(
		float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)),
		0.0,
		float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W))
	)


func _action_axis(negative_action: String, positive_action: String) -> float:
	return (
		float(bool(_held_actions.get(positive_action, false)))
		- float(bool(_held_actions.get(negative_action, false)))
	)


func _update_camera() -> void:
	var offset := Vector3(sin(_camera_yaw) * 7.5, 5.0, cos(_camera_yaw) * 7.5)
	_camera.global_position = _player.global_position + offset
	_camera.look_at(_player.global_position + Vector3(0.0, 0.5, 0.0), Vector3.UP)


func _interact() -> void:
	for collectible_id in COLLECTIBLE_ORDER:
		if bool(_collected.get(collectible_id, false)):
			continue
		var record: Dictionary = _collectibles[collectible_id]
		var area: Area3D = record["area"]
		if _player.global_position.distance_to(area.global_position) <= INTERACTION_DISTANCE:
			_collect(collectible_id)
			return


func _collect(collectible_id: String) -> void:
	if bool(_collected.get(collectible_id, false)):
		return
	_collected[collectible_id] = true
	_score += 1
	_set_collectible_active(collectible_id, false)
	_won = _score == COLLECTIBLE_ORDER.size()
	_update_hud()


func _set_collectible_active(collectible_id: String, active: bool) -> void:
	var record: Dictionary = _collectibles[collectible_id]
	var area: Area3D = record["area"]
	var collision: CollisionShape3D = record["collision"]
	var visual: MeshInstance3D = record["visual"]
	area.monitoring = active
	area.monitorable = active
	collision.set_deferred("disabled", not active)
	visual.visible = active


func _update_hud() -> void:
	_hud_label.text = "Collectibles: %d / %d%s" % [
		_score,
		COLLECTIBLE_ORDER.size(),
		"  -  You win" if _won else "",
	]


func apply_replay_event(action: String, phase: String, value: Variant = null) -> void:
	match phase:
		"pressed", "held":
			_held_actions[action] = true
			if action == "interact" and phase == "pressed":
				_interact()
		"released":
			_held_actions[action] = false
		"axis":
			if action == "camera.look" and value is Array and value.size() == 2:
				_camera_yaw += float(value[0])


func reset_fresh_profile() -> void:
	_player.position = START_POSITION
	_player.velocity = Vector3.ZERO
	_held_actions.clear()
	_collected.clear()
	_score = 0
	_won = false
	_blocked_path_held = false
	_camera_yaw = 0.0
	for collectible_id in COLLECTIBLE_ORDER:
		_collected[collectible_id] = false
		_set_collectible_active(collectible_id, true)
	_update_hud()


func save_game() -> bool:
	var payload := _save_payload()
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(payload))
	file.flush()
	file = null
	return true


func _save_payload() -> Dictionary:
	var collected_ids: Array[String] = []
	for collectible_id in COLLECTIBLE_ORDER:
		if bool(_collected.get(collectible_id, false)):
			collected_ids.append(collectible_id)
	return {
		"schemaVersion": "1.0.0",
		"position": [
			_player.position.x,
			_player.position.y,
			_player.position.z,
		],
		"score": _score,
		"collected": collected_ids,
		"won": _won,
	}


func load_game() -> bool:
	if not FileAccess.file_exists(SAVE_PATH):
		return false
	var text := FileAccess.get_file_as_string(SAVE_PATH)
	var payload: Variant = JSON.parse_string(text)
	if typeof(payload) != TYPE_DICTIONARY or payload.get("schemaVersion") != "1.0.0":
		return false
	var position_value: Variant = payload.get("position")
	var collected_value: Variant = payload.get("collected")
	if not (position_value is Array) or position_value.size() != 3 or not (collected_value is Array):
		return false
	_player.position = Vector3(
		float(position_value[0]),
		float(position_value[1]),
		float(position_value[2])
	)
	_player.velocity = Vector3.ZERO
	_score = int(payload.get("score", 0))
	_won = bool(payload.get("won", false))
	for collectible_id in COLLECTIBLE_ORDER:
		var is_collected := collectible_id in collected_value
		_collected[collectible_id] = is_collected
		_set_collectible_active(collectible_id, not is_collected)
	_update_hud()
	return true


func persistence_state_is_fresh() -> bool:
	return (
		_player.position == START_POSITION
		and _score == 0
		and not _won
		and not bool(_collected.get("first", false))
		and not bool(_collected.get("second", false))
	)


func prepare_persistence_saved_state() -> void:
	_player.position = Vector3(-2.0, 1.0, -6.0)
	_player.velocity = Vector3.ZERO
	_score = 2
	_won = true
	for collectible_id in COLLECTIBLE_ORDER:
		_collected[collectible_id] = true
		_set_collectible_active(collectible_id, false)
	_update_hud()


func persistence_state_is_saved() -> bool:
	return (
		_player.position == Vector3(-2.0, 1.0, -6.0)
		and _score == 2
		and _won
		and bool(_collected.get("first", false))
		and bool(_collected.get("second", false))
	)


func has_state_path(path: String) -> bool:
	return path in [
		"camera.active",
		"camera.target-player",
		"collectibles.first-present",
		"collectibles.remaining",
		"collision.blocked-path-held",
		"game.score",
		"game.won",
		"hud.collectible-count",
		"player.blocked-axis-position",
		"player.control-enabled",
		"player.distance-from-start",
		"player.penetration-depth",
		"player.position.x",
		"player.position.y",
		"player.position.z",
	]


func state_value(path: String) -> Variant:
	match path:
		"camera.active":
			return _camera.current
		"camera.target-player":
			return is_instance_valid(_camera) and is_instance_valid(_player)
		"collectibles.first-present":
			return not bool(_collected.get("first", false))
		"collectibles.remaining":
			return COLLECTIBLE_ORDER.size() - _score
		"collision.blocked-path-held":
			return _blocked_path_held
		"game.score":
			return _score
		"game.won":
			return _won
		"hud.collectible-count":
			return _score
		"player.blocked-axis-position":
			return _player.position.x + PLAYER_RADIUS
		"player.control-enabled":
			return true
		"player.distance-from-start":
			return Vector2(_player.position.x, _player.position.z).distance_to(
				Vector2(START_POSITION.x, START_POSITION.z)
			)
		"player.penetration-depth":
			return maxf(0.0, _player.position.x + PLAYER_RADIUS - WALL_PLANE_X)
		"player.position.x":
			return _player.position.x
		"player.position.y":
			return _player.position.y
		"player.position.z":
			return _player.position.z
	return null


func finish_replay(exit_code: int) -> void:
	if _replay_finished:
		return
	_replay_finished = true
	get_tree().quit(exit_code)


func freeze_runtime_frame() -> void:
	set_physics_process(false)
	_held_actions.clear()
	_player.velocity = Vector3.ZERO
	_update_camera()
	_update_hud()


func finish_persistence(exit_code: int) -> void:
	if _persistence_finished:
		return
	_persistence_finished = true
	get_tree().quit(exit_code)


func _load_scenario() -> Dictionary:
	var text := FileAccess.get_file_as_string("res://scenario.json")
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	if parsed.get("scenarioId") != "scenario.graybox.core":
		return {}
	return parsed

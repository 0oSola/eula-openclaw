"""Build the isolated Blender-first control rig for the thinking-motion POC."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import math
from pathlib import Path
import sys
from typing import Sequence

try:
    import bpy  # type: ignore
    from mathutils import Matrix, Quaternion, Vector  # type: ignore
except ImportError:
    bpy = None
    Matrix = None
    Quaternion = None
    Vector = None


ARMATURE_NAME = "优菈_arm"
MESH_NAME = "优菈_mesh"
REFERENCE_ACTION_NAME = "POC_v16_reference"
OUTPUT_BLEND_NAME = "eula_elegant_thinking_blender_first_poc.blend"
OUTPUT_DIRECTORY_NAME = "blender_first_thinking_poc"
CONTROL_COLLECTION_NAME = "POC_controls"
PALM_SPACE_NAME = "POC_手掌_SPACE"

PROXY_BONE_NAMES = (
    "POC_右腕_CTRL",
    "POC_右ひじ_CTRL",
    "POC_右手_CTRL",
)
PROXY_SOURCE_BONES = {
    PROXY_BONE_NAMES[0]: "右腕",
    PROXY_BONE_NAMES[1]: "右ひじ",
    PROXY_BONE_NAMES[2]: "右手首",
}
CONTROL_NAMES = {
    "hand": "POC_右手_TARGET",
    "pole": "POC_右ひじ_POLE",
    "palm": "POC_手掌_ORIENTATION",
    "chin": "POC_下巴_CONTACT",
}
CONSTRAINT_NAMES = {
    "ik": "POC_右腕_IK",
    "palm_proxy": "POC_手掌_DELTA",
    "upper": "POC_右腕_COPY_ROTATION",
    "elbow": "POC_右ひじ_COPY_ROTATION",
    "upper_twist": "POC_右腕捩_AXIAL",
    "hand_twist": "POC_右手捩_AXIAL",
    "wrist": "POC_右手首_ORIENTATION",
}
CONSTRAINT_SPECS = {
    "palm_proxy": {
        "owner_bone": PROXY_BONE_NAMES[2],
        "target_control": CONTROL_NAMES["palm"],
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "REPLACE",
    },
    "upper": {
        "owner_bone": "右腕",
        "target_bone": PROXY_BONE_NAMES[0],
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    },
    "elbow": {
        "owner_bone": "右ひじ",
        "target_bone": PROXY_BONE_NAMES[1],
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    },
    "upper_twist": {
        "owner_bone": "右腕捩",
        "target_bone": PROXY_BONE_NAMES[2],
        "constraint_type": "COPY_ROTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "ADD",
        "rotation_axes": "Y",
    },
    "hand_twist": {
        "owner_bone": "右手捩",
        "target_bone": PROXY_BONE_NAMES[2],
        "constraint_type": "COPY_ROTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "ADD",
        "rotation_axes": "Y",
    },
    "wrist": {
        "owner_bone": "右手首",
        "target_bone": PROXY_BONE_NAMES[2],
        "constraint_type": "COPY_ROTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "ADD",
        "rotation_axes": "XYZ",
    },
}

REQUIRED_BONES = (
    "右肩",
    "右肩C",
    "右腕",
    "右腕捩",
    "右ひじ",
    "右手捩",
    "右手首",
    "頭",
)
EXPECTED_ACTION_RANGE = (0.0, 240.0)
VALIDATION_FRAME = 150
LENGTH_TOLERANCE = 1e-5
ROLL_TOLERANCE = 1e-6
ENABLED_DELTA_LIMIT_DEG = 10.0
BASELINE_RESTORE_TOLERANCE_DEG = 1e-4

# Rendered PMX calibration identifies right-elbow +Z as strongest flexion.
# Axis isolation against v16 maps that motion to proxy local Z: it reproduces
# the elbow plane at dot=0.999999 while local X misses by 0.2595 Blender units.
ELBOW_HINGE_AXIS = "Z"
ELBOW_IK_LOCKS = {"X": True, "Y": True, "Z": False}
ELBOW_IK_MIN_DEG = -150.0
ELBOW_IK_MAX_DEG = 0.0
ELBOW_FLEX_MIN_DEG = -150.0
ELBOW_FLEX_MAX_DEG = -5.0
ELBOW_OFF_AXIS_MAX_DEG = 0.1
ELBOW_ANGLE_MIN_DEG = 20.0
ELBOW_ANGLE_MAX_DEG = 175.0

HAND_TARGET_DIAGNOSTIC_OFFSET = (0.01, 0.0, 0.0)
HAND_RESPONSE_MIN_DEG = 0.25
HAND_RESPONSE_MAX_DEG = 10.0
PALM_AXIAL_DIAGNOSTIC_DEG = 10.0
PALM_RESPONSE_TOLERANCE_DEG = 1.0
PALM_OFF_AXIS_MAX_DEG = 1.0

SAVE_VERSION_OVERRIDE = 0


@dataclass(frozen=True)
class PocConfig:
    source_blend: Path
    vmd: Path
    output_blend: Path
    output_dir: Path
    frame_start: int
    frame_end: int
    setup_only: bool


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--vmd", type=Path, required=True)
    parser.add_argument("--output-blend", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--frame-start", type=int, default=0)
    parser.add_argument("--frame-end", type=int, default=240)
    parser.add_argument("--setup-only", action="store_true")
    return parser


def _validated_config(namespace: argparse.Namespace) -> PocConfig:
    source_blend = namespace.source_blend.resolve()
    vmd = namespace.vmd.resolve()
    output_blend = namespace.output_blend.resolve()
    output_dir = namespace.output_dir.resolve()

    if not source_blend.is_file():
        raise ValueError(f"Source blend does not exist: {source_blend}")
    if source_blend.suffix.lower() != ".blend":
        raise ValueError(f"Source blend must use the .blend extension: {source_blend}")
    if not vmd.is_file():
        raise ValueError(f"Reference VMD does not exist: {vmd}")
    if vmd.suffix.lower() != ".vmd":
        raise ValueError(f"Reference VMD must use the .vmd extension: {vmd}")
    if output_blend.name != OUTPUT_BLEND_NAME:
        raise ValueError(f"Output blend must be named {OUTPUT_BLEND_NAME}")
    if output_dir.name != OUTPUT_DIRECTORY_NAME:
        raise ValueError(f"Output directory must be named {OUTPUT_DIRECTORY_NAME}")
    if namespace.frame_start < 0 or namespace.frame_end < namespace.frame_start:
        raise ValueError("Frame range must be a valid non-negative interval")

    return PocConfig(
        source_blend=source_blend,
        vmd=vmd,
        output_blend=output_blend,
        output_dir=output_dir,
        frame_start=namespace.frame_start,
        frame_end=namespace.frame_end,
        setup_only=namespace.setup_only,
    )


def parse_blender_args(argv: Sequence[str] | None = None) -> PocConfig:
    arguments = list(sys.argv if argv is None else argv)
    if "--" not in arguments:
        raise ValueError("POC arguments must appear after Blender's -- separator")
    return _validated_config(_parser().parse_args(arguments[arguments.index("--") + 1 :]))


def signed_elbow_flex_is_valid(flex_degrees: float) -> bool:
    flex = float(flex_degrees)
    return math.isfinite(flex) and ELBOW_FLEX_MIN_DEG <= flex <= ELBOW_FLEX_MAX_DEG


def blender_backup_path(output_blend: Path) -> Path:
    return Path(f"{output_blend}1")


def _require_blender() -> None:
    if bpy is None or Matrix is None or Quaternion is None or Vector is None:
        raise RuntimeError("This operation must run inside Blender")


def _same_path(left: Path, right: Path) -> bool:
    return str(left.resolve()).casefold() == str(right.resolve()).casefold()


def _select_armature(armature) -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature


def _validate_scene_objects():
    armature = bpy.data.objects.get(ARMATURE_NAME)
    mesh = bpy.data.objects.get(MESH_NAME)
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(f"Missing armature object {ARMATURE_NAME}")
    if mesh is None or mesh.type != "MESH":
        raise RuntimeError(f"Missing mesh object {MESH_NAME}")
    missing = [name for name in REQUIRED_BONES if name not in armature.data.bones]
    if missing:
        raise RuntimeError(f"Missing required PMX bones: {', '.join(missing)}")
    return armature, mesh


def _import_reference_action(config: PocConfig, armature):
    _select_armature(armature)

    # mmd_tools offsets imported keys from the current scene frame.
    bpy.context.scene.frame_set(0)
    result = bpy.ops.mmd_tools.import_vmd(
        filepath=str(config.vmd),
        bone_mapper="PMX",
        scale=0.08,
        margin=0,
        create_new_action=True,
        use_pose_mode=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"mmd_tools VMD import failed: {sorted(result)}")

    animation_data = armature.animation_data
    action = animation_data.action if animation_data else None
    if action is None:
        raise RuntimeError("VMD import did not assign an action to the armature")
    action.name = REFERENCE_ACTION_NAME
    action_range = tuple(float(value) for value in action.frame_range)
    if action_range != EXPECTED_ACTION_RANGE:
        raise RuntimeError(
            f"Imported action range must be exactly 0-240, got {action_range[0]:g}-{action_range[1]:g}"
        )
    return action


def _create_proxy_chain(armature) -> None:
    _select_armature(armature)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones
    geometry = {
        proxy_name: (
            edit_bones[source_name].head.copy(),
            edit_bones[source_name].tail.copy(),
            float(edit_bones[source_name].roll),
        )
        for proxy_name, source_name in PROXY_SOURCE_BONES.items()
    }
    for name in PROXY_BONE_NAMES:
        existing = edit_bones.get(name)
        if existing is not None:
            edit_bones.remove(existing)

    upper = edit_bones.new(PROXY_BONE_NAMES[0])
    upper.head, upper.tail, upper.roll = geometry[PROXY_BONE_NAMES[0]]
    upper.parent = edit_bones["右肩C"]
    upper.use_connect = False
    upper.use_deform = False

    forearm = edit_bones.new(PROXY_BONE_NAMES[1])
    forearm.head, forearm.tail, forearm.roll = geometry[PROXY_BONE_NAMES[1]]
    forearm.parent = upper
    forearm.use_connect = True
    forearm.use_deform = False

    hand = edit_bones.new(PROXY_BONE_NAMES[2])
    hand.head, hand.tail, hand.roll = geometry[PROXY_BONE_NAMES[2]]
    hand.parent = forearm
    hand.use_connect = True
    hand.use_deform = False
    for proxy_name, source_name in PROXY_SOURCE_BONES.items():
        roll_delta = abs(edit_bones[proxy_name].roll - edit_bones[source_name].roll)
        if roll_delta > ROLL_TOLERANCE:
            raise RuntimeError(
                f"Proxy roll mismatch for {proxy_name}: {edit_bones[proxy_name].roll} vs "
                f"{edit_bones[source_name].roll}"
            )
    bpy.ops.object.mode_set(mode="POSE")
    armature.pose.bones[PROXY_BONE_NAMES[0]].ik_stretch = 0.0
    armature.pose.bones[PROXY_BONE_NAMES[1]].ik_stretch = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")


def _world_point(armature, point):
    return armature.matrix_world @ point


def _pose_head_world(armature, bone_name: str):
    return _world_point(armature, armature.pose.bones[bone_name].head)


def _create_control(collection, name: str, location, display_type: str, size: float):
    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    control = bpy.data.objects.new(name, None)
    collection.objects.link(control)
    control.empty_display_type = display_type
    control.empty_display_size = size
    control.location = location
    control.show_in_front = True
    return control


def _create_controls(armature):
    collection = bpy.data.collections.get(CONTROL_COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(CONTROL_COLLECTION_NAME)
        bpy.context.scene.collection.children.link(collection)

    shoulder = _pose_head_world(armature, "右腕")
    elbow = _pose_head_world(armature, "右ひじ")
    wrist = _pose_head_world(armature, "右手首")
    reach_axis = wrist - shoulder
    if reach_axis.length_squared <= 1e-12:
        raise RuntimeError("Cannot build controls from a zero-length shoulder-to-wrist axis")
    elbow_radial = elbow - shoulder - reach_axis * ((elbow - shoulder).dot(reach_axis) / reach_axis.length_squared)
    if elbow_radial.length < 1e-6:
        elbow_radial = armature.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))
    pole_location = elbow + elbow_radial.normalized() * 0.5

    palm_space = _create_control(
        collection,
        PALM_SPACE_NAME,
        wrist,
        "PLAIN_AXES",
        0.08,
    )
    palm_space.matrix_world = armature.matrix_world @ armature.pose.bones["右手首"].matrix

    controls = {
        "hand": _create_control(collection, CONTROL_NAMES["hand"], wrist, "SPHERE", 0.08),
        "pole": _create_control(collection, CONTROL_NAMES["pole"], pole_location, "CUBE", 0.08),
        "palm": _create_control(collection, CONTROL_NAMES["palm"], wrist, "ARROWS", 0.12),
        "chin": _create_control(
            collection,
            CONTROL_NAMES["chin"],
            _pose_head_world(armature, "頭") + (armature.matrix_world.to_3x3() @ Vector((0.0, -0.08, -0.18))),
            "SPHERE",
            0.05,
        ),
    }
    controls["palm"].parent = palm_space
    controls["palm"].matrix_parent_inverse = Matrix.Identity(4)
    controls["palm"].matrix_basis = Matrix.Identity(4)
    return controls


def _add_influence_driver(constraint, armature, property_name: str) -> None:
    driver = constraint.driver_add("influence").driver
    driver.type = "SCRIPTED"
    enabled = driver.variables.new()
    enabled.name = "enabled"
    enabled.targets[0].id = armature
    enabled.targets[0].data_path = '["POC_enabled"]'
    weight = driver.variables.new()
    weight.name = "weight"
    weight.targets[0].id = armature
    weight.targets[0].data_path = f'["{property_name}"]'
    driver.expression = "enabled * weight"


def _new_copy_rotation(armature, name: str, target, spec):
    pose_bone = armature.pose.bones[spec["owner_bone"]]
    old = pose_bone.constraints.get(name)
    if old is not None:
        pose_bone.constraints.remove(old)
    constraint = pose_bone.constraints.new(spec.get("constraint_type", "COPY_ROTATION"))
    constraint.name = name
    constraint.target = target
    constraint.subtarget = spec.get("target_bone", "")
    constraint.owner_space = spec["owner_space"]
    constraint.target_space = spec["target_space"]
    constraint.mix_mode = spec["mix_mode"]
    axes = spec.get("rotation_axes", "XYZ")
    constraint.use_x = "X" in axes
    constraint.use_y = "Y" in axes
    constraint.use_z = "Z" in axes
    constraint.influence = 0.0
    return constraint


def _new_child_of_rotation(armature, name: str, spec):
    pose_bone = armature.pose.bones[spec["owner_bone"]]
    old = pose_bone.constraints.get(name)
    if old is not None:
        pose_bone.constraints.remove(old)
    constraint = pose_bone.constraints.new(spec["constraint_type"])
    constraint.name = name
    constraint.target = armature
    constraint.subtarget = spec["target_bone"]
    constraint.use_location_x = False
    constraint.use_location_y = False
    constraint.use_location_z = False
    constraint.use_scale_x = False
    constraint.use_scale_y = False
    constraint.use_scale_z = False
    axes = spec["rotation_axes"]
    constraint.use_rotation_x = "X" in axes
    constraint.use_rotation_y = "Y" in axes
    constraint.use_rotation_z = "Z" in axes

    constraint.influence = 1.0
    _select_armature(armature)
    bpy.ops.object.mode_set(mode="POSE")
    armature.data.bones.active = armature.data.bones[spec["owner_bone"]]
    bpy.context.view_layer.update()
    result = bpy.ops.constraint.childof_set_inverse(constraint=name, owner="BONE")
    if "FINISHED" not in result:
        raise RuntimeError(f"Failed to calibrate inverse matrix for {name}: {sorted(result)}")
    constraint.influence = 0.0
    return constraint


def _proxy_elbow_pole_side(armature, pole_control) -> float:
    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    axis = end - root
    if axis.length_squared <= 1e-12:
        raise RuntimeError("Proxy chain has a zero-length shoulder-to-wrist axis")
    elbow_offset = elbow - root - axis * ((elbow - root).dot(axis) / axis.length_squared)
    pole_offset = pole_control.location - root - axis * (
        (pole_control.location - root).dot(axis) / axis.length_squared
    )
    return elbow_offset.dot(pole_offset)


def _create_constraints(armature, controls) -> None:
    proxy_forearm = armature.pose.bones[PROXY_BONE_NAMES[1]]
    old_ik = proxy_forearm.constraints.get(CONSTRAINT_NAMES["ik"])
    if old_ik is not None:
        proxy_forearm.constraints.remove(old_ik)
    ik = proxy_forearm.constraints.new("IK")
    ik.name = CONSTRAINT_NAMES["ik"]
    ik.target = controls["hand"]
    ik.pole_target = controls["pole"]
    ik.chain_count = 2
    ik.use_tail = True
    ik.use_stretch = False
    proxy_forearm.lock_ik_x = ELBOW_IK_LOCKS["X"]
    proxy_forearm.lock_ik_y = ELBOW_IK_LOCKS["Y"]
    proxy_forearm.lock_ik_z = ELBOW_IK_LOCKS["Z"]
    proxy_forearm.use_ik_limit_x = False
    proxy_forearm.use_ik_limit_y = False
    proxy_forearm.use_ik_limit_z = True
    proxy_forearm.ik_min_z = math.radians(ELBOW_IK_MIN_DEG)
    proxy_forearm.ik_max_z = math.radians(ELBOW_IK_MAX_DEG)
    bpy.context.scene.frame_set(VALIDATION_FRAME - 1)
    bpy.context.scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()
    if _proxy_elbow_pole_side(armature, controls["pole"]) <= 0.0:
        ik.pole_angle = math.pi
        bpy.context.scene.frame_set(VALIDATION_FRAME - 1)
        bpy.context.scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
    if _proxy_elbow_pole_side(armature, controls["pole"]) <= 0.0:
        raise RuntimeError("Unable to align the proxy IK elbow with its pole target")

    palm_proxy = _new_copy_rotation(
        armature,
        CONSTRAINT_NAMES["palm_proxy"],
        controls["palm"],
        CONSTRAINT_SPECS["palm_proxy"],
    )
    palm_proxy.influence = 1.0

    properties = {
        "POC_enabled": 0.0,
        "POC_upper_arm_influence": 1.0,
        "POC_elbow_influence": 1.0,
        "POC_upper_twist_influence": 0.25,
        "POC_hand_twist_influence": 0.50,
        "POC_wrist_influence": 0.25,
    }
    for name, value in properties.items():
        armature[name] = value
        armature.id_properties_ui(name).update(min=0.0, max=1.0)

    driven = (
        (
            _new_child_of_rotation(
                armature,
                CONSTRAINT_NAMES["upper"],
                CONSTRAINT_SPECS["upper"],
            ),
            "POC_upper_arm_influence",
        ),
        (
            _new_child_of_rotation(
                armature,
                CONSTRAINT_NAMES["elbow"],
                CONSTRAINT_SPECS["elbow"],
            ),
            "POC_elbow_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                CONSTRAINT_NAMES["upper_twist"],
                armature,
                CONSTRAINT_SPECS["upper_twist"],
            ),
            "POC_upper_twist_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                CONSTRAINT_NAMES["hand_twist"],
                armature,
                CONSTRAINT_SPECS["hand_twist"],
            ),
            "POC_hand_twist_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                CONSTRAINT_NAMES["wrist"],
                armature,
                CONSTRAINT_SPECS["wrist"],
            ),
            "POC_wrist_influence",
        ),
    )
    for constraint, property_name in driven:
        _add_influence_driver(constraint, armature, property_name)
    bpy.ops.object.mode_set(mode="OBJECT")


def _finite_matrix(matrix) -> bool:
    return all(math.isfinite(value) for row in matrix for value in row)


def _world_rotation(armature, bone_name: str):
    return (armature.matrix_world @ armature.pose.bones[bone_name].matrix).to_quaternion()


def _rotation_delta_degrees(before, after) -> float:
    degrees = math.degrees(before.rotation_difference(after).angle)
    return min(degrees, abs(360.0 - degrees))


def _evaluated_local_rotation(armature, bone_name: str):
    pose_bone = armature.pose.bones[bone_name]
    parent = pose_bone.parent
    if parent is None:
        return (pose_bone.bone.matrix_local.inverted() @ pose_bone.matrix).to_quaternion()
    current_relative = parent.matrix.inverted() @ pose_bone.matrix
    rest_relative = parent.bone.matrix_local.inverted() @ pose_bone.bone.matrix_local
    return (rest_relative.inverted() @ current_relative).to_quaternion()


def _signed_proxy_elbow_flex(armature) -> tuple[float, float]:
    euler = _evaluated_local_rotation(armature, PROXY_BONE_NAMES[1]).to_euler("XYZ")
    flex_degrees = math.degrees(euler.z)
    off_axis_degrees = math.degrees(math.hypot(euler.x, euler.y))
    return flex_degrees, off_axis_degrees


def _local_y_twist_response(before, after) -> tuple[float, float, float]:
    delta = (before.inverted() @ after).normalized()
    twist = Quaternion((delta.w, 0.0, delta.y, 0.0))
    if twist.magnitude <= 1e-12:
        twist = Quaternion((1.0, 0.0, 0.0, 0.0))
    else:
        twist.normalize()
    swing = (delta @ twist.inverted()).normalized()
    twist_degrees = math.degrees(2.0 * math.atan2(twist.y, twist.w))
    return twist_degrees, math.degrees(swing.angle), math.degrees(delta.angle)


def _set_poc_enabled(armature, scene, enabled: bool) -> None:
    armature["POC_enabled"] = 1.0 if enabled else 0.0
    armature.update_tag()
    scene.frame_set(VALIDATION_FRAME - 1)
    scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()


def _run_behavior_diagnostics(armature, controls) -> None:
    scene = bpy.context.scene
    diagnostic_bones = ("右腕", "右ひじ", "右腕捩", "右手捩", "右手首")
    baseline_rotations = {name: _world_rotation(armature, name) for name in diagnostic_bones}
    hand_location = controls["hand"].location.copy()
    palm_basis = controls["palm"].matrix_basis.copy()
    failures: list[str] = []

    try:
        _set_poc_enabled(armature, scene, True)
        enabled_rotations = {name: _world_rotation(armature, name) for name in diagnostic_bones}
        enabled_deltas = {
            name: _rotation_delta_degrees(baseline_rotations[name], enabled_rotations[name])
            for name in ("右腕", "右ひじ", "右手首")
        }
        print("POC_ENABLED_DELTAS_DEG", enabled_deltas)
        for name, delta in enabled_deltas.items():
            if delta >= ENABLED_DELTA_LIMIT_DEG:
                failures.append(f"{name} baseline enable delta is {delta:.6f} degrees")

        controls["hand"].location += armature.matrix_world.to_3x3() @ Vector(
            HAND_TARGET_DIAGNOSTIC_OFFSET
        )
        armature.update_tag()
        scene.frame_set(VALIDATION_FRAME - 1)
        scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
        translated_rotations = {
            name: _world_rotation(armature, name) for name in ("右腕", "右ひじ", "右手首")
        }
        hand_response = {
            name: _rotation_delta_degrees(enabled_rotations[name], translated_rotations[name])
            for name in translated_rotations
        }
        print("POC_HAND_TARGET_RESPONSE_DEG", hand_response)
        for name in ("右腕", "右ひじ"):
            response = hand_response[name]
            if not HAND_RESPONSE_MIN_DEG <= response <= HAND_RESPONSE_MAX_DEG:
                failures.append(f"{name} hand-target response is {response:.6f} degrees")

        controls["hand"].location = hand_location
        armature.update_tag()
        scene.frame_set(VALIDATION_FRAME - 1)
        scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
        hand_restore = {
            name: _rotation_delta_degrees(enabled_rotations[name], _world_rotation(armature, name))
            for name in diagnostic_bones
        }
        if any(delta > BASELINE_RESTORE_TOLERANCE_DEG for delta in hand_restore.values()):
            failures.append(f"hand target did not restore enabled baseline: {hand_restore}")

        palm_bones = {
            "右腕捩": "POC_upper_twist_influence",
            "右手捩": "POC_hand_twist_influence",
            "右手首": "POC_wrist_influence",
        }
        palm_before = {name: _evaluated_local_rotation(armature, name) for name in palm_bones}
        controls["palm"].rotation_mode = "XYZ"
        controls["palm"].rotation_euler.y = math.radians(PALM_AXIAL_DIAGNOSTIC_DEG)
        armature.update_tag()
        scene.frame_set(VALIDATION_FRAME - 1)
        scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
        palm_response = {}
        for name, property_name in palm_bones.items():
            twist, off_axis, total = _local_y_twist_response(
                palm_before[name],
                _evaluated_local_rotation(armature, name),
            )
            expected = PALM_AXIAL_DIAGNOSTIC_DEG * float(armature[property_name])
            palm_response[name] = {
                "twist_y": twist,
                "off_axis": off_axis,
                "total": total,
                "expected": expected,
            }
            if abs(abs(twist) - expected) > PALM_RESPONSE_TOLERANCE_DEG:
                failures.append(
                    f"{name} palm twist response {twist:.6f} differs from expected {expected:.6f}"
                )
            if off_axis > PALM_OFF_AXIS_MAX_DEG:
                failures.append(f"{name} palm off-axis response is {off_axis:.6f} degrees")
        print("POC_PALM_AXIAL_RESPONSE_DEG", palm_response)
    finally:
        controls["hand"].location = hand_location
        controls["palm"].matrix_basis = palm_basis
        _set_poc_enabled(armature, scene, False)

    restored_rotations = {name: _world_rotation(armature, name) for name in diagnostic_bones}
    restore_deltas = {
        name: _rotation_delta_degrees(baseline_rotations[name], restored_rotations[name])
        for name in diagnostic_bones
    }
    print("POC_RESTORE_DELTAS_DEG", restore_deltas)
    if any(delta > BASELINE_RESTORE_TOLERANCE_DEG for delta in restore_deltas.values()):
        failures.append(f"disabled POC chain did not restore v16 baseline: {restore_deltas}")
    if failures:
        raise RuntimeError("POC behavior diagnostics failed: " + "; ".join(failures))


def _validate_setup(armature, action, controls) -> None:
    scene = bpy.context.scene
    scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()

    if tuple(float(value) for value in action.frame_range) != EXPECTED_ACTION_RANGE:
        raise RuntimeError("Reference action range changed after rig construction")
    if float(armature["POC_enabled"]) != 0.0:
        raise RuntimeError("POC deform-chain influence must remain disabled in the baseline setup")

    for name in PROXY_BONE_NAMES:
        bone = armature.data.bones.get(name)
        if bone is None or bone.use_deform:
            raise RuntimeError(f"Invalid non-deforming proxy bone: {name}")

    proxy_forearm = armature.pose.bones[PROXY_BONE_NAMES[1]]
    actual_locks = {
        "X": proxy_forearm.lock_ik_x,
        "Y": proxy_forearm.lock_ik_y,
        "Z": proxy_forearm.lock_ik_z,
    }
    if actual_locks != ELBOW_IK_LOCKS:
        raise RuntimeError(f"Proxy elbow IK locks are invalid: {actual_locks}")
    if (
        not proxy_forearm.use_ik_limit_z
        or abs(math.degrees(proxy_forearm.ik_min_z) - ELBOW_IK_MIN_DEG) > 1e-4
        or abs(math.degrees(proxy_forearm.ik_max_z) - ELBOW_IK_MAX_DEG) > 1e-4
    ):
        raise RuntimeError("Proxy elbow local-Z hinge limits are invalid")

    expected_lengths = (
        (armature.data.bones["右ひじ"].head_local - armature.data.bones["右腕"].head_local).length,
        (armature.data.bones["右手首"].head_local - armature.data.bones["右ひじ"].head_local).length,
    )
    for name, expected in zip(PROXY_BONE_NAMES[:2], expected_lengths, strict=True):
        pose_bone = armature.pose.bones[name]
        evaluated = (pose_bone.tail - pose_bone.head).length
        if expected <= 0.0 or evaluated <= 0.0 or abs(evaluated - expected) > LENGTH_TOLERANCE:
            raise RuntimeError(f"Proxy segment length is invalid for {name}: expected {expected}, got {evaluated}")
        if not _finite_matrix(pose_bone.matrix):
            raise RuntimeError(f"Proxy pose matrix is not finite: {name}")

    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    if _proxy_elbow_pole_side(armature, controls["pole"]) <= 0.0:
        raise RuntimeError("Proxy elbow is not on the pole-facing side")
    bend = math.degrees((root - elbow).angle(end - elbow))
    if not math.isfinite(bend) or not ELBOW_ANGLE_MIN_DEG <= bend <= ELBOW_ANGLE_MAX_DEG:
        raise RuntimeError(f"Proxy elbow bend is invalid: {bend}")
    signed_flex, off_axis_flex = _signed_proxy_elbow_flex(armature)
    if not signed_elbow_flex_is_valid(signed_flex):
        raise RuntimeError(f"Proxy elbow signed flex is reversed or hyperextended: {signed_flex}")
    if off_axis_flex > ELBOW_OFF_AXIS_MAX_DEG:
        raise RuntimeError(
            f"Proxy elbow flex left the local-{ELBOW_HINGE_AXIS} hinge: {off_axis_flex} degrees"
        )
    print(
        "POC_ELBOW_HINGE",
        {
            "axis": ELBOW_HINGE_AXIS,
            "signed_flex_deg": signed_flex,
            "off_axis_deg": off_axis_flex,
            "anatomical_angle_deg": bend,
        },
    )

    expected_targets = {
        CONSTRAINT_NAMES["ik"]: (PROXY_BONE_NAMES[1], controls["hand"], "", controls["pole"]),
        CONSTRAINT_NAMES["palm_proxy"]: (
            PROXY_BONE_NAMES[2],
            controls["palm"],
            "",
            None,
        ),
        CONSTRAINT_NAMES["upper"]: (
            CONSTRAINT_SPECS["upper"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["upper"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["elbow"]: (
            CONSTRAINT_SPECS["elbow"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["elbow"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["upper_twist"]: (
            CONSTRAINT_SPECS["upper_twist"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["upper_twist"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["hand_twist"]: (
            CONSTRAINT_SPECS["hand_twist"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["hand_twist"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["wrist"]: (
            CONSTRAINT_SPECS["wrist"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["wrist"]["target_bone"],
            None,
        ),
    }
    for constraint_name, (bone_name, target, subtarget, pole_target) in expected_targets.items():
        constraint = armature.pose.bones[bone_name].constraints.get(constraint_name)
        if constraint is None or constraint.target != target:
            raise RuntimeError(f"Missing or mistargeted constraint: {constraint_name}")
        if constraint.subtarget != subtarget:
            raise RuntimeError(
                f"Constraint {constraint_name} must target subtarget {subtarget!r}, "
                f"got {constraint.subtarget!r}"
            )
        if pole_target is not None and constraint.pole_target != pole_target:
            raise RuntimeError(f"Missing or mistargeted pole target: {constraint_name}")
        spec_key = next(
            key for key, configured_name in CONSTRAINT_NAMES.items() if configured_name == constraint_name
        )
        expected_type = (
            "IK"
            if spec_key == "ik"
            else CONSTRAINT_SPECS[spec_key].get("constraint_type", "COPY_ROTATION")
        )
        if constraint.type != expected_type:
            raise RuntimeError(
                f"Constraint {constraint_name} must use {expected_type}, got {constraint.type}"
            )
        if constraint.type == "CHILD_OF" and not _finite_matrix(constraint.inverse_matrix):
            raise RuntimeError(f"Constraint inverse matrix is not finite: {constraint_name}")
        if "rotation_axes" in CONSTRAINT_SPECS.get(spec_key, {}):
            expected_axes = CONSTRAINT_SPECS[spec_key]["rotation_axes"]
            if constraint.type == "CHILD_OF":
                axis_flags = (
                    ("X", constraint.use_rotation_x),
                    ("Y", constraint.use_rotation_y),
                    ("Z", constraint.use_rotation_z),
                )
            else:
                axis_flags = (
                    ("X", constraint.use_x),
                    ("Y", constraint.use_y),
                    ("Z", constraint.use_z),
                )
            actual_axes = "".join(axis for axis, enabled in axis_flags if enabled)
            if actual_axes != expected_axes:
                raise RuntimeError(
                    f"Constraint {constraint_name} rotation axes must be {expected_axes}, "
                    f"got {actual_axes}"
                )
        if constraint_name not in (CONSTRAINT_NAMES["ik"], CONSTRAINT_NAMES["palm_proxy"]) and constraint.influence != 0.0:
            raise RuntimeError(f"Baseline POC constraint must be disabled: {constraint_name}")

    for name, control in controls.items():
        if control.name != CONTROL_NAMES[name] or not _finite_matrix(control.matrix_world):
            raise RuntimeError(f"Invalid control object: {CONTROL_NAMES[name]}")
        if any(value <= 0.0 or not math.isfinite(value) for value in control.scale):
            raise RuntimeError(f"Invalid control scale: {control.name}")

    palm_control = controls["palm"]
    if palm_control.parent is None or palm_control.parent.name != PALM_SPACE_NAME:
        raise RuntimeError(f"Palm control must be parented to {PALM_SPACE_NAME}")
    if any(abs(value) > 1e-8 for value in palm_control.rotation_euler):
        raise RuntimeError("Palm control must have zero local rotation in the baseline setup")
    palm_constraint = armature.pose.bones[PROXY_BONE_NAMES[2]].constraints[
        CONSTRAINT_NAMES["palm_proxy"]
    ]
    palm_spec = CONSTRAINT_SPECS["palm_proxy"]
    if (
        palm_constraint.owner_space != palm_spec["owner_space"]
        or palm_constraint.target_space != palm_spec["target_space"]
        or palm_constraint.mix_mode != palm_spec["mix_mode"]
    ):
        raise RuntimeError("Palm delta constraint uses incompatible rotation spaces")

    _run_behavior_diagnostics(armature, controls)


def _save_setup_blend(output_blend: Path) -> None:
    backup_path = blender_backup_path(output_blend)
    if backup_path.exists():
        backup_path.unlink()

    file_preferences = bpy.context.preferences.filepaths
    original_save_version = int(file_preferences.save_version)
    try:
        file_preferences.save_version = SAVE_VERSION_OVERRIDE
        result = bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), check_existing=False)
        if "FINISHED" not in result:
            raise RuntimeError(f"Failed to save POC blend: {sorted(result)}")
    finally:
        file_preferences.save_version = original_save_version

    if backup_path.exists():
        backup_path.unlink()
        raise RuntimeError(f"Blender created an unexpected backup artifact: {backup_path}")


def build_setup(config: PocConfig) -> None:
    _require_blender()
    if not config.setup_only:
        raise ValueError("Task 2 only supports --setup-only; VMD export is intentionally disabled")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must be opened with the requested source blend: {config.source_blend}")

    armature, _mesh = _validate_scene_objects()
    action = _import_reference_action(config, armature)
    bpy.context.scene.frame_start = config.frame_start
    bpy.context.scene.frame_end = config.frame_end
    bpy.context.scene.frame_set(VALIDATION_FRAME)
    _create_proxy_chain(armature)
    controls = _create_controls(armature)
    _create_constraints(armature, controls)
    _validate_setup(armature, action, controls)

    config.output_dir.mkdir(parents=True, exist_ok=True)
    config.output_blend.parent.mkdir(parents=True, exist_ok=True)
    _save_setup_blend(config.output_blend)
    print(f"POC_SETUP_SAVED {config.output_blend}")


def main(argv: Sequence[str] | None = None) -> int:
    config = parse_blender_args(argv)
    build_setup(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

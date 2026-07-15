"""Build the isolated Blender-first control rig for the thinking-motion POC."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import importlib.util
import itertools
import json
import math
from pathlib import Path
import sys
from typing import Sequence

try:
    import bpy  # type: ignore
    from mathutils import Euler, Matrix, Quaternion, Vector  # type: ignore
    from mathutils.bvhtree import BVHTree  # type: ignore
except ImportError:
    bpy = None
    Euler = None
    Matrix = None
    Quaternion = None
    Vector = None
    BVHTree = None


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

PMX_CHIN_SURFACE = (0.0, 18.44, -0.50)
PMX_TO_BLENDER_SCALE = 0.08
CANDIDATE_VIEWS = ("front", "left", "right", "back")
STATIC_RENDER_COUNT = 6
STATIC_METRICS_NAME = "static_pose_metrics.json"
STATIC_CANDIDATE_DIRECTORY = "candidates"
STATIC_CAMERA_NAME = "POC Static Full Body Camera"

CONTACT_VERTEX_GROUPS = (
    "右親指０",
    "右親指１",
    "右親指２",
    "右人指１",
    "右人指２",
    "右人指３",
)
EVIDENCE_VERTEX_GROUPS = (
    "右手首",
    "右親指０",
    "右親指１",
    "右親指２",
    "右人指１",
    "右人指２",
    "右人指３",
    "右中指１",
    "右薬指１",
    "右小指１",
)
RIGHT_HAND_VERTEX_GROUPS = (
    "右手首",
    "右親指０",
    "右親指１",
    "右親指２",
    "右親指先",
    "右人指１",
    "右人指２",
    "右人指３",
    "右人指先",
    "右中指１",
    "右中指２",
    "右中指３",
    "右中指先",
    "右薬指１",
    "右薬指２",
    "右薬指３",
    "右薬指先",
    "右小指１",
    "右小指２",
    "右小指３",
    "右小指先",
)
PALM_VERTEX_GROUPS = ("右手首",)
RIGHT_FOREARM_VERTEX_GROUPS = (
    "右ひじ",
    "右手捩",
    "右手捩1",
    "右手捩2",
    "右手捩3",
)
ADJACENT_RIGHT_ARM_VERTEX_GROUPS = (
    "右肩",
    "右肩C",
    "右腕",
    "右腕捩",
    "右腕捩1",
    "右腕捩2",
    "右腕捩3",
    *RIGHT_FOREARM_VERTEX_GROUPS,
    *RIGHT_HAND_VERTEX_GROUPS,
)
HEAD_VERTEX_GROUPS = ("頭", "首")
TORSO_VERTEX_GROUPS = ("上半身", "上半身2", "上半身3", "首", "下半身")
MIN_GROUP_WEIGHT = 1e-4
MESH_PENETRATION_TOLERANCE = 5e-5
CONTACT_ALIGNMENT_GAIN = 0.5
FULL_BODY_MARGIN = 1.18
RENDER_RESOLUTION = 768


@dataclass(frozen=True)
class StaticCandidate:
    candidate_id: str
    hand_offset: tuple[float, float, float]
    palm_euler_deg: tuple[float, float, float]
    pole_offset: float
    twist_influences: tuple[float, float, float]


@dataclass(frozen=True)
class PocConfig:
    source_blend: Path
    vmd: Path | None
    output_blend: Path
    output_dir: Path
    frame_start: int
    frame_end: int
    setup_only: bool
    solve_static: bool


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--vmd", type=Path)
    parser.add_argument("--output-blend", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--frame-start", type=int, default=0)
    parser.add_argument("--frame-end", type=int, default=240)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--setup-only", action="store_true")
    mode.add_argument("--solve-static", action="store_true")
    return parser


def _validated_config(namespace: argparse.Namespace) -> PocConfig:
    source_blend = namespace.source_blend.resolve()
    vmd = namespace.vmd.resolve() if namespace.vmd is not None else None
    output_blend = namespace.output_blend.resolve()
    output_dir = namespace.output_dir.resolve()

    if not source_blend.is_file():
        raise ValueError(f"Source blend does not exist: {source_blend}")
    if source_blend.suffix.lower() != ".blend":
        raise ValueError(f"Source blend must use the .blend extension: {source_blend}")
    if namespace.setup_only:
        if vmd is None or not vmd.is_file():
            raise ValueError(f"Reference VMD does not exist: {vmd}")
        if vmd.suffix.lower() != ".vmd":
            raise ValueError(f"Reference VMD must use the .vmd extension: {vmd}")
    if output_blend.name != OUTPUT_BLEND_NAME:
        raise ValueError(f"Output blend must be named {OUTPUT_BLEND_NAME}")
    if output_dir.name != OUTPUT_DIRECTORY_NAME:
        raise ValueError(f"Output directory must be named {OUTPUT_DIRECTORY_NAME}")
    if namespace.solve_static and (
        source_blend.name != OUTPUT_BLEND_NAME or not _same_path(source_blend, output_blend)
    ):
        raise ValueError("Solve-static must open and save the same existing POC blend")
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
        solve_static=namespace.solve_static,
    )


def parse_blender_args(argv: Sequence[str] | None = None) -> PocConfig:
    arguments = list(sys.argv if argv is None else argv)
    if "--" not in arguments:
        raise ValueError("POC arguments must appear after Blender's -- separator")
    return _validated_config(_parser().parse_args(arguments[arguments.index("--") + 1 :]))


def pmx_point_to_blender_rest(point: Sequence[float]) -> tuple[float, float, float]:
    if len(point) != 3:
        raise ValueError("PMX point must have three components")
    x, y, z = (float(value) for value in point)
    if not all(math.isfinite(value) for value in (x, y, z)):
        raise ValueError("PMX point must be finite")
    return (x * PMX_TO_BLENDER_SCALE, z * PMX_TO_BLENDER_SCALE, y * PMX_TO_BLENDER_SCALE)


def static_candidate_grid() -> tuple[StaticCandidate, ...]:
    hand_offsets = (
        (0.0, 0.0, 0.0),
        (-0.012, 0.006, -0.006),
        (0.012, -0.006, 0.006),
    )
    palm_orientations = (
        (0.0, 0.0, 0.0),
        (-12.0, 16.0, -8.0),
        (10.0, -12.0, 8.0),
    )
    pole_offsets = (-0.08, 0.0, 0.08)
    twist_allocations = (
        (0.25, 0.50, 0.25),
        (0.35, 0.50, 0.15),
        (0.20, 0.60, 0.20),
    )
    combinations = itertools.product(
        hand_offsets,
        palm_orientations,
        pole_offsets,
        twist_allocations,
    )
    return tuple(
        StaticCandidate(
            candidate_id=f"candidate_{index:03d}",
            hand_offset=hand_offset,
            palm_euler_deg=palm_euler_deg,
            pole_offset=pole_offset,
            twist_influences=twist_influences,
        )
        for index, (hand_offset, palm_euler_deg, pole_offset, twist_influences) in enumerate(
            combinations,
            1,
        )
    )


def candidate_render_names(count: int = STATIC_RENDER_COUNT) -> tuple[str, ...]:
    if count < 0:
        raise ValueError("Candidate render count cannot be negative")
    return tuple(
        f"candidate_{candidate_index:03d}/{view}.png"
        for candidate_index in range(1, count + 1)
        for view in CANDIDATE_VIEWS
    )


def signed_elbow_flex_is_valid(flex_degrees: float) -> bool:
    flex = float(flex_degrees)
    return math.isfinite(flex) and ELBOW_FLEX_MIN_DEG <= flex <= ELBOW_FLEX_MAX_DEG


def blender_backup_path(output_blend: Path) -> Path:
    return Path(f"{output_blend}1")


def _require_blender() -> None:
    if (
        bpy is None
        or Euler is None
        or Matrix is None
        or Quaternion is None
        or Vector is None
        or BVHTree is None
    ):
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


def _calibrated_chin_points(armature):
    rest_point = Vector(pmx_point_to_blender_rest(PMX_CHIN_SURFACE))
    head_rest = armature.data.bones["頭"].matrix_local
    head_local = head_rest.inverted() @ rest_point
    world_point = armature.matrix_world @ armature.pose.bones["頭"].matrix @ head_local
    return rest_point, head_local, world_point


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
            _calibrated_chin_points(armature)[2],
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


def _load_motion_math():
    module_name = "blender_first_motion_math"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    tool_path = Path(__file__).with_name(f"{module_name}.py")
    spec = importlib.util.spec_from_file_location(module_name, tool_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load motion math module: {tool_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _existing_controls():
    controls = {key: bpy.data.objects.get(name) for key, name in CONTROL_NAMES.items()}
    missing = [CONTROL_NAMES[key] for key, control in controls.items() if control is None]
    if missing:
        raise RuntimeError(f"Existing POC blend is missing controls: {', '.join(missing)}")
    return controls


def _validate_existing_poc(armature, controls) -> None:
    action = armature.animation_data.action if armature.animation_data else None
    if action is None or action.name != REFERENCE_ACTION_NAME:
        raise RuntimeError(f"Existing POC blend must use action {REFERENCE_ACTION_NAME}")
    if tuple(float(value) for value in action.frame_range) != EXPECTED_ACTION_RANGE:
        raise RuntimeError("Existing POC reference action range must remain 0-240")
    for name in PROXY_BONE_NAMES:
        bone = armature.data.bones.get(name)
        if bone is None or bone.use_deform:
            raise RuntimeError(f"Existing POC blend has an invalid proxy bone: {name}")
    expected = (
        (PROXY_BONE_NAMES[1], CONSTRAINT_NAMES["ik"]),
        (PROXY_BONE_NAMES[2], CONSTRAINT_NAMES["palm_proxy"]),
        ("右腕", CONSTRAINT_NAMES["upper"]),
        ("右ひじ", CONSTRAINT_NAMES["elbow"]),
        ("右腕捩", CONSTRAINT_NAMES["upper_twist"]),
        ("右手捩", CONSTRAINT_NAMES["hand_twist"]),
        ("右手首", CONSTRAINT_NAMES["wrist"]),
    )
    missing_constraints = [
        constraint_name
        for bone_name, constraint_name in expected
        if armature.pose.bones[bone_name].constraints.get(constraint_name) is None
    ]
    if missing_constraints:
        raise RuntimeError(
            f"Existing POC blend is missing constraints: {', '.join(missing_constraints)}"
        )
    if controls["palm"].parent is None or controls["palm"].parent.name != PALM_SPACE_NAME:
        raise RuntimeError("Existing POC palm control is not in its calibrated local space")


def _group_indices(mesh, names: Sequence[str]) -> set[int]:
    missing = [name for name in names if mesh.vertex_groups.get(name) is None]
    if missing:
        raise RuntimeError(f"Mesh is missing required vertex groups: {', '.join(missing)}")
    return {mesh.vertex_groups[name].index for name in names}


def _vertices_for_groups(mesh, group_indices: set[int]) -> set[int]:
    return {
        vertex.index
        for vertex in mesh.data.vertices
        if any(
            membership.group in group_indices and membership.weight > MIN_GROUP_WEIGHT
            for membership in vertex.groups
        )
    }


def polygon_belongs_to_region(
    polygon_vertices: Sequence[int],
    included: set[int],
    excluded: set[int],
) -> bool:
    vertices = tuple(int(vertex) for vertex in polygon_vertices)
    return bool(vertices) and all(vertex in included for vertex in vertices) and not any(
        vertex in excluded for vertex in vertices
    )


def _polygons_touching(mesh, included: set[int], excluded: set[int] | None = None):
    excluded = excluded or set()
    return tuple(
        tuple(polygon.vertices)
        for polygon in mesh.data.polygons
        if polygon_belongs_to_region(polygon.vertices, included, excluded)
    )


def _mesh_geometry_sets(mesh):
    contact = _vertices_for_groups(mesh, _group_indices(mesh, CONTACT_VERTEX_GROUPS))
    hand = _vertices_for_groups(mesh, _group_indices(mesh, RIGHT_HAND_VERTEX_GROUPS))
    palm = _vertices_for_groups(mesh, _group_indices(mesh, PALM_VERTEX_GROUPS))
    forearm = _vertices_for_groups(mesh, _group_indices(mesh, RIGHT_FOREARM_VERTEX_GROUPS))
    head = _vertices_for_groups(mesh, _group_indices(mesh, HEAD_VERTEX_GROUPS))
    torso = _vertices_for_groups(mesh, _group_indices(mesh, TORSO_VERTEX_GROUPS))
    adjacent = _vertices_for_groups(
        mesh,
        _group_indices(mesh, ADJACENT_RIGHT_ARM_VERTEX_GROUPS),
    )
    moving = hand | forearm
    return {
        "contact_vertices": contact,
        "hand_vertices": hand,
        "moving_vertices": moving,
        "palm_faces": _polygons_touching(mesh, palm),
        "moving_faces": _polygons_touching(mesh, moving),
        "head_faces": _polygons_touching(mesh, head),
        "torso_faces": _polygons_touching(mesh, torso, adjacent),
        "group_counts": {
            name: len(
                _vertices_for_groups(mesh, _group_indices(mesh, (name,)))
            )
            for name in EVIDENCE_VERTEX_GROUPS
        },
    }


def _evaluated_world_vertices(mesh):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        if len(evaluated_mesh.vertices) != len(mesh.data.vertices):
            raise RuntimeError("Evaluated mesh topology changed; vertex-group evidence is invalid")
        return tuple(evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices)
    finally:
        evaluated.to_mesh_clear()


def _bvh(vertices, polygons):
    if not polygons:
        raise RuntimeError("Cannot build collision evidence from an empty polygon set")
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def _nearest_surface_evidence(points, tree):
    minimum_distance = math.inf
    maximum_penetration = 0.0
    for point in points:
        nearest = tree.find_nearest(point)
        if nearest is None:
            continue
        location, normal, _index, distance = nearest
        minimum_distance = min(minimum_distance, float(distance))
        signed_distance = (point - location).dot(normal)
        if signed_distance < -MESH_PENETRATION_TOLERANCE:
            maximum_penetration = max(maximum_penetration, -float(signed_distance))
    return minimum_distance, maximum_penetration


def _mesh_evidence(mesh, geometry, chin_world):
    vertices = _evaluated_world_vertices(mesh)
    contact_error = min((vertices[index] - chin_world).length for index in geometry["contact_vertices"])
    head_tree = _bvh(vertices, geometry["head_faces"])
    torso_tree = _bvh(vertices, geometry["torso_faces"])
    palm_tree = _bvh(vertices, geometry["palm_faces"])
    moving_tree = _bvh(vertices, geometry["moving_faces"])
    _head_clearance, head_penetration = _nearest_surface_evidence(
        (vertices[index] for index in geometry["hand_vertices"]),
        head_tree,
    )
    head_intersections = len(palm_tree.overlap(head_tree))
    if head_intersections:
        head_penetration = max(head_penetration, MESH_PENETRATION_TOLERANCE * 2.0)
    else:
        head_penetration = 0.0
    minimum_clearance, _torso_signed_penetration = _nearest_surface_evidence(
        (vertices[index] for index in geometry["moving_vertices"]),
        torso_tree,
    )
    torso_intersections = len(moving_tree.overlap(torso_tree))
    return {
        "contact_error": float(contact_error),
        "head_penetration_depth": float(head_penetration),
        "head_intersection_count": int(head_intersections),
        "torso_penetration_count": int(torso_intersections),
        "minimum_clearance": float(minimum_clearance),
    }, vertices


def _refresh_frame(frame: int = VALIDATION_FRAME) -> None:
    scene = bpy.context.scene
    scene.frame_set(frame - 1)
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def _capture_pose_state(armature, frame: int):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return {
        "elbow": _pose_head_world(armature, "右ひじ").copy(),
        "wrist": _pose_head_world(armature, "右手首").copy(),
        "local_rotations": {
            name: _evaluated_local_rotation(armature, name).copy()
            for name in ("右腕捩", "右手捩", "右手首")
        },
    }


def _reset_static_controls_to_v16(armature, controls):
    armature["POC_enabled"] = 0.0
    controls["palm"].matrix_basis = Matrix.Identity(4)
    armature.update_tag()
    _refresh_frame()
    shoulder = _pose_head_world(armature, "右腕")
    elbow = _pose_head_world(armature, "右ひじ")
    wrist = _pose_head_world(armature, "右手首")
    reach_axis = wrist - shoulder
    elbow_radial = elbow - shoulder - reach_axis * (
        (elbow - shoulder).dot(reach_axis) / reach_axis.length_squared
    )
    if elbow_radial.length < 1e-6:
        elbow_radial = armature.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))
    controls["hand"].location = wrist
    controls["pole"].location = elbow + elbow_radial.normalized() * 0.5
    _refresh_frame()


def _apply_static_candidate(armature, controls, candidate, base_hand, base_pole, pole_axis):
    controls["hand"].location = base_hand + Vector(candidate.hand_offset)
    controls["pole"].location = base_pole + pole_axis * candidate.pole_offset
    controls["palm"].rotation_mode = "XYZ"
    controls["palm"].rotation_euler = Euler(
        tuple(math.radians(value) for value in candidate.palm_euler_deg),
        "XYZ",
    )
    upper_twist, hand_twist, wrist = candidate.twist_influences
    armature["POC_upper_twist_influence"] = upper_twist
    armature["POC_hand_twist_influence"] = hand_twist
    armature["POC_wrist_influence"] = wrist
    armature["POC_enabled"] = 1.0
    armature.update_tag()
    _refresh_frame()


def _candidate_measurements(armature, mesh, controls, geometry, candidate, previous):
    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    elbow_angle = math.degrees((root - elbow).angle(end - elbow))
    signed_flex, off_axis_flex = _signed_proxy_elbow_flex(armature)
    pole_side = _proxy_elbow_pole_side(armature, controls["pole"])
    upper_twist, upper_swing, _upper_total = _local_y_twist_response(
        previous["local_rotations"]["右腕捩"],
        _evaluated_local_rotation(armature, "右腕捩"),
    )
    hand_twist, hand_swing, _hand_total = _local_y_twist_response(
        previous["local_rotations"]["右手捩"],
        _evaluated_local_rotation(armature, "右手捩"),
    )
    wrist_twist, wrist_swing, _wrist_total = _local_y_twist_response(
        previous["local_rotations"]["右手首"],
        _evaluated_local_rotation(armature, "右手首"),
    )
    chin_rest, chin_local, chin_world = _calibrated_chin_points(armature)
    controls["chin"].location = chin_world
    mesh_metrics, vertices = _mesh_evidence(mesh, geometry, chin_world)
    continuity = max(
        (_pose_head_world(armature, "右ひじ") - previous["elbow"]).length,
        (_pose_head_world(armature, "右手首") - previous["wrist"]).length,
    )
    relevant_matrices = (
        armature.matrix_world,
        *(armature.pose.bones[name].matrix for name in (*PROXY_BONE_NAMES, "右腕", "右ひじ", "右手首")),
        *(control.matrix_world for control in controls.values()),
    )
    measurements = {
        "elbow_angle_deg": elbow_angle,
        "signed_elbow_flex_deg": signed_flex,
        "elbow_off_axis_deg": off_axis_flex,
        "pole_side": pole_side,
        "wrist_swing_deg": wrist_swing,
        "wrist_twist_deg": wrist_twist,
        "forearm_twist_deg": upper_twist + hand_twist,
        "upper_twist_deg": upper_twist,
        "hand_twist_deg": hand_twist,
        "upper_twist_swing_deg": upper_swing,
        "hand_twist_swing_deg": hand_swing,
        "continuity_distance": continuity,
        "matrices_finite": all(_finite_matrix(matrix) for matrix in relevant_matrices),
        "hand_target_world": tuple(float(value) for value in controls["hand"].location),
        "pole_target_world": tuple(float(value) for value in controls["pole"].location),
        "palm_local_euler_deg": tuple(
            math.degrees(float(value)) for value in controls["palm"].rotation_euler
        ),
        "twist_influences": (
            float(armature["POC_upper_twist_influence"]),
            float(armature["POC_hand_twist_influence"]),
            float(armature["POC_wrist_influence"]),
        ),
        **mesh_metrics,
        "chin_rest": tuple(float(value) for value in chin_rest),
        "chin_head_local": tuple(float(value) for value in chin_local),
        "chin_world": tuple(float(value) for value in chin_world),
    }
    return measurements, vertices


def _candidate_record(candidate, measurements, score):
    reasons = list(score.reasons)
    if measurements["elbow_off_axis_deg"] > ELBOW_OFF_AXIS_MAX_DEG:
        reasons.append(
            f"Proxy elbow left the local-{ELBOW_HINGE_AXIS} hinge by "
            f"{measurements['elbow_off_axis_deg']:.6f} degrees"
        )
    valid = score.valid and measurements["elbow_off_axis_deg"] <= ELBOW_OFF_AXIS_MAX_DEG
    if not valid:
        verdict = "FAIL"
    elif reasons or any(value > 0.0 for value in score.component_penalties.values()):
        verdict = "WARN"
    else:
        verdict = "PASS"
    return {
        "source_candidate_id": candidate.candidate_id,
        "parameters": {
            "hand_offset": candidate.hand_offset,
            "palm_euler_deg": candidate.palm_euler_deg,
            "pole_offset": candidate.pole_offset,
            "twist_influences": candidate.twist_influences,
        },
        "valid": valid,
        "verdict": verdict,
        "reasons": reasons,
        "score": float(score.total_score),
        "component_penalties": score.component_penalties,
        "metrics": measurements,
    }


def _rank_key(item):
    _candidate, record = item
    return (
        not record["valid"],
        record["score"],
        record["source_candidate_id"],
    )


def _full_body_camera(scene, all_vertices):
    minimum = Vector((
        min(vertex.x for vertex in all_vertices),
        min(vertex.y for vertex in all_vertices),
        min(vertex.z for vertex in all_vertices),
    ))
    maximum = Vector((
        max(vertex.x for vertex in all_vertices),
        max(vertex.y for vertex in all_vertices),
        max(vertex.z for vertex in all_vertices),
    ))
    center = (minimum + maximum) * 0.5
    extents = maximum - minimum
    ortho_scale = max(extents.x, extents.y, extents.z) * FULL_BODY_MARGIN
    distance = max(extents) * 3.0 + 2.0
    old = bpy.data.objects.get(STATIC_CAMERA_NAME)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    camera_data = bpy.data.cameras.new(STATIC_CAMERA_NAME)
    camera = bpy.data.objects.new(STATIC_CAMERA_NAME, camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ortho_scale
    scene.camera = camera
    return camera, center, distance, ortho_scale, minimum, maximum


def _render_candidates(config, armature, controls, ranked, base_hand, base_pole, pole_axis, vertices_by_candidate):
    scene = bpy.context.scene
    candidate_root = config.output_dir / STATIC_CANDIDATE_DIRECTORY
    candidate_root.mkdir(parents=True, exist_ok=True)
    combined_vertices = tuple(
        vertex
        for candidate, _record in ranked[:STATIC_RENDER_COUNT]
        for vertex in vertices_by_candidate[candidate.candidate_id]
    )
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(
        scene,
        combined_vertices,
    )
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    view_directions = {
        "front": Vector((0.0, -1.0, 0.0)),
        "left": Vector((1.0, 0.0, 0.0)),
        "right": Vector((-1.0, 0.0, 0.0)),
        "back": Vector((0.0, 1.0, 0.0)),
    }
    rendered = []
    for rank, (candidate, record) in enumerate(ranked[:STATIC_RENDER_COUNT], 1):
        _apply_static_candidate(armature, controls, candidate, base_hand, base_pole, pole_axis)
        directory = candidate_root / f"candidate_{rank:03d}"
        directory.mkdir(parents=True, exist_ok=True)
        record["rank"] = rank
        record["render_directory"] = str(directory)
        record["renders"] = {}
        for view, direction in view_directions.items():
            camera.location = center + direction * distance
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            output = directory / f"{view}.png"
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            record["renders"][view] = str(output)
            rendered.append(str(output))
    return {
        "camera_name": camera.name,
        "ortho_scale": float(ortho_scale),
        "center": tuple(float(value) for value in center),
        "bbox_min": tuple(float(value) for value in bbox_min),
        "bbox_max": tuple(float(value) for value in bbox_max),
        "resolution": (RENDER_RESOLUTION, RENDER_RESOLUTION),
        "view_semantics": {
            "front": "camera at -Y",
            "left": "character-left view, camera at +X",
            "right": "character-right view, camera at -X",
            "back": "camera at +Y",
        },
        "rendered_files": rendered,
    }


def solve_static(config: PocConfig) -> None:
    _require_blender()
    if not config.solve_static:
        raise ValueError("Static solver requires --solve-static")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    armature, mesh = _validate_scene_objects()
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    scene = bpy.context.scene
    scene.frame_set(VALIDATION_FRAME)
    _reset_static_controls_to_v16(armature, controls)
    previous = _capture_pose_state(armature, VALIDATION_FRAME - 1)
    scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()
    chin_rest, chin_local, chin_world = _calibrated_chin_points(armature)
    controls["chin"].location = chin_world
    baseline_vertices = _evaluated_world_vertices(mesh)
    baseline_mesh_metrics, _baseline_mesh_vertices = _mesh_evidence(mesh, geometry, chin_world)
    contact_anchor = min(
        (baseline_vertices[index] for index in geometry["contact_vertices"]),
        key=lambda point: (point - chin_world).length,
    )
    base_hand = controls["hand"].location.copy() + (chin_world - contact_anchor) * CONTACT_ALIGNMENT_GAIN
    base_pole = controls["pole"].location.copy()
    pole_axis = armature.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    pole_axis.normalize()
    print(
        "POC_STATIC_BASELINE",
        {
            "chin": tuple(chin_world),
            "contact_anchor": tuple(contact_anchor),
            "contact_delta": tuple(chin_world - contact_anchor),
            "hand_control": tuple(controls["hand"].location),
            "base_hand": tuple(base_hand),
            "wrist": tuple(_pose_head_world(armature, "右手首")),
            "mesh_metrics": baseline_mesh_metrics,
            "face_counts": {
                key: len(geometry[key])
                for key in ("palm_faces", "moving_faces", "head_faces", "torso_faces")
            },
        },
    )

    evaluated = []
    vertices_by_candidate = {}
    for candidate in static_candidate_grid():
        _apply_static_candidate(armature, controls, candidate, base_hand, base_pole, pole_axis)
        measurements, vertices = _candidate_measurements(
            armature,
            mesh,
            controls,
            geometry,
            candidate,
            previous,
        )
        score = math_module.score_static_candidate(
            elbow_angle_deg=measurements["elbow_angle_deg"],
            signed_elbow_flex_deg=measurements["signed_elbow_flex_deg"],
            pole_side=measurements["pole_side"],
            wrist_swing_deg=measurements["wrist_swing_deg"],
            wrist_twist_deg=measurements["wrist_twist_deg"],
            forearm_twist_deg=measurements["forearm_twist_deg"],
            contact_error=measurements["contact_error"],
            head_penetration_depth=measurements["head_penetration_depth"],
            torso_penetration_count=measurements["torso_penetration_count"],
            minimum_clearance=measurements["minimum_clearance"],
            continuity_distance=measurements["continuity_distance"],
            matrices_finite=measurements["matrices_finite"],
        )
        record = _candidate_record(candidate, measurements, score)
        evaluated.append((candidate, record))
        vertices_by_candidate[candidate.candidate_id] = vertices

    ranked = sorted(evaluated, key=_rank_key)
    valid = [item for item in ranked if item[1]["valid"]]
    if len(valid) < STATIC_RENDER_COUNT:
        rejection_counts = {}
        for _candidate, record in ranked:
            for reason in record["reasons"]:
                rejection_counts[reason] = rejection_counts.get(reason, 0) + 1
        print("POC_STATIC_REJECTION_COUNTS", rejection_counts)
        print(
            "POC_STATIC_TOP_REJECTED",
            [
                {
                    "candidate": record["source_candidate_id"],
                    "reasons": record["reasons"],
                    "metrics": record["metrics"],
                }
                for _candidate, record in ranked[:3]
            ],
        )
        raise RuntimeError(
            f"Static solver found only {len(valid)} valid candidates; at least {STATIC_RENDER_COUNT} are required"
        )
    ranked = valid + [item for item in ranked if not item[1]["valid"]]
    render_evidence = _render_candidates(
        config,
        armature,
        controls,
        ranked,
        base_hand,
        base_pole,
        pole_axis,
        vertices_by_candidate,
    )
    selected_candidate, selected_record = ranked[0]
    _apply_static_candidate(
        armature,
        controls,
        selected_candidate,
        base_hand,
        base_pole,
        pole_axis,
    )
    armature["POC_selected_static_candidate"] = selected_candidate.candidate_id
    armature["POC_selected_static_score"] = selected_record["score"]
    armature["POC_chin_head_local"] = tuple(float(value) for value in chin_local)
    armature["POC_chin_rest"] = tuple(float(value) for value in chin_rest)
    config.output_dir.mkdir(parents=True, exist_ok=True)
    metrics = {
        "mode": "solve-static",
        "frame": VALIDATION_FRAME,
        "source_blend": str(config.source_blend),
        "output_blend": str(config.output_blend),
        "candidate_count": len(evaluated),
        "valid_count": len(valid),
        "rejected_count": len(evaluated) - len(valid),
        "rendered_count": STATIC_RENDER_COUNT,
        "selected_source_candidate_id": selected_candidate.candidate_id,
        "selected_rank": 1,
        "chin_calibration": {
            "pmx_surface": PMX_CHIN_SURFACE,
            "rest_blender": tuple(float(value) for value in chin_rest),
            "head_local": tuple(float(value) for value in chin_local),
            "world_frame_150": tuple(float(value) for value in chin_world),
        },
        "contact_vertex_group_counts": geometry["group_counts"],
        "baseline_contact_anchor": tuple(float(value) for value in contact_anchor),
        "base_hand_target": tuple(float(value) for value in base_hand),
        "render_evidence": render_evidence,
        "candidates": [record for _candidate, record in ranked],
    }
    metrics_path = config.output_dir / STATIC_METRICS_NAME
    metrics_path.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    _save_setup_blend(config.output_blend)
    print(
        "POC_STATIC_SOLVED",
        {
            "evaluated": len(evaluated),
            "rejected": len(evaluated) - len(valid),
            "rendered": STATIC_RENDER_COUNT,
            "selected": selected_candidate.candidate_id,
            "score": selected_record["score"],
            "metrics": str(metrics_path),
        },
    )


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
    if config.setup_only:
        build_setup(config)
    elif config.solve_static:
        solve_static(config)
    else:
        raise ValueError("No POC mode selected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

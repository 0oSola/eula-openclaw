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
    from mathutils import Matrix, Vector  # type: ignore
except ImportError:
    bpy = None
    Matrix = None
    Vector = None


ARMATURE_NAME = "优菈_arm"
MESH_NAME = "优菈_mesh"
REFERENCE_ACTION_NAME = "POC_v16_reference"
OUTPUT_BLEND_NAME = "eula_elegant_thinking_blender_first_poc.blend"
OUTPUT_DIRECTORY_NAME = "blender_first_thinking_poc"
CONTROL_COLLECTION_NAME = "POC_controls"

PROXY_BONE_NAMES = (
    "POC_右腕_CTRL",
    "POC_右ひじ_CTRL",
    "POC_右手_CTRL",
)
CONTROL_NAMES = {
    "hand": "POC_右手_TARGET",
    "pole": "POC_右ひじ_POLE",
    "palm": "POC_手掌_ORIENTATION",
    "chin": "POC_下巴_CONTACT",
}
CONSTRAINT_NAMES = {
    "ik": "POC_右腕_IK",
    "upper": "POC_右腕_COPY_ROTATION",
    "elbow": "POC_右ひじ_COPY_ROTATION",
    "upper_twist": "POC_右腕捩_AXIAL",
    "hand_twist": "POC_右手捩_AXIAL",
    "wrist": "POC_右手首_ORIENTATION",
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


def _require_blender() -> None:
    if bpy is None or Matrix is None or Vector is None:
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
    source = armature.data.bones
    geometry = {
        PROXY_BONE_NAMES[0]: (source["右腕"].head_local.copy(), source["右ひじ"].head_local.copy()),
        PROXY_BONE_NAMES[1]: (source["右ひじ"].head_local.copy(), source["右手首"].head_local.copy()),
        PROXY_BONE_NAMES[2]: (source["右手首"].head_local.copy(), source["右手首"].tail_local.copy()),
    }

    _select_armature(armature)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones
    for name in PROXY_BONE_NAMES:
        existing = edit_bones.get(name)
        if existing is not None:
            edit_bones.remove(existing)

    upper = edit_bones.new(PROXY_BONE_NAMES[0])
    upper.head, upper.tail = geometry[PROXY_BONE_NAMES[0]]
    upper.parent = edit_bones["右肩C"]
    upper.use_connect = False
    upper.use_deform = False

    forearm = edit_bones.new(PROXY_BONE_NAMES[1])
    forearm.head, forearm.tail = geometry[PROXY_BONE_NAMES[1]]
    forearm.parent = upper
    forearm.use_connect = True
    forearm.use_deform = False

    hand = edit_bones.new(PROXY_BONE_NAMES[2])
    hand.head, hand.tail = geometry[PROXY_BONE_NAMES[2]]
    hand.parent = forearm
    hand.use_connect = True
    hand.use_deform = False
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
    controls["palm"].matrix_world = armature.matrix_world @ armature.pose.bones["右手首"].matrix
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


def _new_copy_rotation(armature, bone_name: str, name: str, target, *, subtarget: str = "", axial: bool = False):
    pose_bone = armature.pose.bones[bone_name]
    old = pose_bone.constraints.get(name)
    if old is not None:
        pose_bone.constraints.remove(old)
    constraint = pose_bone.constraints.new("COPY_ROTATION")
    constraint.name = name
    constraint.target = target
    constraint.subtarget = subtarget
    constraint.owner_space = "LOCAL"
    constraint.target_space = "LOCAL"
    constraint.mix_mode = "REPLACE"
    if axial:
        constraint.use_x = False
        constraint.use_y = True
        constraint.use_z = False
    constraint.influence = 0.0
    return constraint


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
            _new_copy_rotation(
                armature,
                "右腕",
                CONSTRAINT_NAMES["upper"],
                armature,
                subtarget=PROXY_BONE_NAMES[0],
            ),
            "POC_upper_arm_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                "右ひじ",
                CONSTRAINT_NAMES["elbow"],
                armature,
                subtarget=PROXY_BONE_NAMES[1],
            ),
            "POC_elbow_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                "右腕捩",
                CONSTRAINT_NAMES["upper_twist"],
                controls["palm"],
                axial=True,
            ),
            "POC_upper_twist_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                "右手捩",
                CONSTRAINT_NAMES["hand_twist"],
                controls["palm"],
                axial=True,
            ),
            "POC_hand_twist_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                "右手首",
                CONSTRAINT_NAMES["wrist"],
                controls["palm"],
            ),
            "POC_wrist_influence",
        ),
    )
    for constraint, property_name in driven:
        _add_influence_driver(constraint, armature, property_name)


def _finite_matrix(matrix) -> bool:
    return all(math.isfinite(value) for row in matrix for value in row)


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
    axis = end - root
    elbow_offset = elbow - root - axis * ((elbow - root).dot(axis) / axis.length_squared)
    pole_offset = controls["pole"].location - root - axis * ((controls["pole"].location - root).dot(axis) / axis.length_squared)
    if elbow_offset.dot(pole_offset) <= 0.0:
        raise RuntimeError("Proxy elbow is not on the pole-facing side")
    bend = math.degrees((root - elbow).angle(end - elbow))
    if not math.isfinite(bend) or bend <= 0.0 or bend >= 180.0:
        raise RuntimeError(f"Proxy elbow bend is invalid: {bend}")

    expected_targets = {
        CONSTRAINT_NAMES["ik"]: (PROXY_BONE_NAMES[1], controls["hand"], controls["pole"]),
        CONSTRAINT_NAMES["upper"]: ("右腕", armature, None),
        CONSTRAINT_NAMES["elbow"]: ("右ひじ", armature, None),
        CONSTRAINT_NAMES["upper_twist"]: ("右腕捩", controls["palm"], None),
        CONSTRAINT_NAMES["hand_twist"]: ("右手捩", controls["palm"], None),
        CONSTRAINT_NAMES["wrist"]: ("右手首", controls["palm"], None),
    }
    for constraint_name, (bone_name, target, pole_target) in expected_targets.items():
        constraint = armature.pose.bones[bone_name].constraints.get(constraint_name)
        if constraint is None or constraint.target != target:
            raise RuntimeError(f"Missing or mistargeted constraint: {constraint_name}")
        if pole_target is not None and constraint.pole_target != pole_target:
            raise RuntimeError(f"Missing or mistargeted pole target: {constraint_name}")
        if constraint_name != CONSTRAINT_NAMES["ik"] and constraint.influence != 0.0:
            raise RuntimeError(f"Baseline POC constraint must be disabled: {constraint_name}")

    for name, control in controls.items():
        if control.name != CONTROL_NAMES[name] or not _finite_matrix(control.matrix_world):
            raise RuntimeError(f"Invalid control object: {CONTROL_NAMES[name]}")
        if any(value <= 0.0 or not math.isfinite(value) for value in control.scale):
            raise RuntimeError(f"Invalid control scale: {control.name}")


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
    bpy.ops.wm.save_as_mainfile(filepath=str(config.output_blend), check_existing=False)
    print(f"POC_SETUP_SAVED {config.output_blend}")


def main(argv: Sequence[str] | None = None) -> int:
    config = parse_blender_args(argv)
    build_setup(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

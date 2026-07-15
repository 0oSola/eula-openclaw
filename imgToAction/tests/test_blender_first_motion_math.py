import importlib.util
import math
from pathlib import Path
import sys

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "blender_first_motion_math.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("blender_first_motion_math", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def distance(left, right):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right, strict=True)))


def test_unreachable_target_can_be_clamped_or_rejected():
    tool = load_tool()

    clamped = tool.clamped_two_bone_reach(
        root=(0.0, 0.0, 0.0),
        target=(3.0, 0.0, 0.0),
        upper_length=1.0,
        lower_length=1.0,
    )

    assert clamped.reachable is False
    assert clamped.clamped is True
    assert clamped.end == pytest.approx((2.0, 0.0, 0.0))
    assert clamped.solved_distance == pytest.approx(2.0)

    with pytest.raises(tool.UnreachableTargetError, match="outside the two-bone reach interval"):
        tool.clamped_two_bone_reach(
            root=(0.0, 0.0, 0.0),
            target=(3.0, 0.0, 0.0),
            upper_length=1.0,
            lower_length=1.0,
            reject_unreachable=True,
        )


def test_two_bone_solution_preserves_both_segment_lengths():
    tool = load_tool()

    solution = tool.solve_two_bone(
        root=(0.0, 0.0, 0.0),
        target=(1.2, 0.4, 0.0),
        upper_length=1.0,
        lower_length=0.8,
        pole=(0.0, 0.0, 1.0),
    )

    assert distance(solution.root, solution.elbow) == pytest.approx(1.0)
    assert distance(solution.elbow, solution.end) == pytest.approx(0.8)


def test_elbow_candidate_is_selected_on_the_pole_facing_side():
    tool = load_tool()
    root = (0.0, 0.0, 0.0)
    target = (1.0, 0.0, 0.0)
    pole = (0.0, 0.0, 1.0)

    solution = tool.solve_two_bone(root, target, 1.0, 1.0, pole)

    projected_pole = tool.project_onto_plane(tool.vector_subtract(pole, root), target)
    elbow_offset = tool.project_onto_plane(tool.vector_subtract(solution.elbow, root), target)
    assert tool.dot(elbow_offset, projected_pole) > 0.0


def test_adjacent_targets_keep_the_same_elbow_side():
    tool = load_tool()
    root = (0.0, 0.0, 0.0)
    pole = (0.0, 0.0, 1.0)
    first = tool.solve_two_bone(root, (1.0, 0.0, 0.0), 1.0, 1.0, pole)
    second = tool.solve_two_bone(
        root,
        (1.0, 0.01, 0.0),
        1.0,
        1.0,
        pole,
        previous_elbow=first.elbow,
    )

    first_sign = tool.elbow_side(root, first.end, first.elbow, pole)
    second_sign = tool.elbow_side(root, second.end, second.elbow, pole)
    assert first_sign > 0.0
    assert second_sign > 0.0
    assert distance(first.elbow, second.elbow) < 0.05


def test_projection_and_signed_angle_use_tuple_vectors():
    tool = load_tool()

    assert tool.project_onto_plane((1.0, 2.0, 3.0), (0.0, 0.0, 1.0)) == pytest.approx((1.0, 2.0, 0.0))
    assert tool.signed_angle((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)) == pytest.approx(90.0)
    assert tool.signed_angle((1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0)) == pytest.approx(-90.0)


def test_continuity_score_prefers_nearby_same_side_candidate():
    tool = load_tool()
    previous = (0.5, 0.0, 0.8)

    same_side = tool.continuity_score(
        candidate=(0.51, 0.01, 0.79),
        previous=previous,
        root=(0.0, 0.0, 0.0),
        end=(1.0, 0.0, 0.0),
    )
    flipped = tool.continuity_score(
        candidate=(0.5, 0.0, -0.8),
        previous=previous,
        root=(0.0, 0.0, 0.0),
        end=(1.0, 0.0, 0.0),
    )

    assert same_side < flipped


def test_anatomical_score_rejects_hard_elbow_reversal():
    tool = load_tool()

    result = tool.score_anatomy(
        elbow_angle_deg=-2.0,
        wrist_swing_deg=10.0,
        forearm_twist_deg=20.0,
    )

    assert result.valid is False
    assert result.measurements["elbow_angle_deg"] == -2.0
    assert any("reversed" in reason for reason in result.reasons)


def test_elbow_and_wrist_comfort_ranges_have_no_penalty():
    tool = load_tool()

    result = tool.score_anatomy(
        elbow_angle_deg=75.0,
        wrist_swing_deg=20.0,
        forearm_twist_deg=30.0,
    )

    assert result.valid is True
    assert result.component_penalties["elbow"] == 0.0
    assert result.component_penalties["wrist_swing"] == 0.0
    assert result.component_penalties["forearm_twist"] == 0.0
    assert result.total_penalty == 0.0


def test_forearm_twist_allocation_is_bounded_and_preserves_requested_twist():
    tool = load_tool()

    allocation = tool.allocate_forearm_twist(110.0)

    assert allocation.forearm_twist_deg == tool.FOREARM_TWIST_HARD_MAX_DEG
    assert allocation.wrist_twist_deg == pytest.approx(110.0 - tool.FOREARM_TWIST_HARD_MAX_DEG)
    assert allocation.forearm_twist_deg + allocation.wrist_twist_deg == pytest.approx(110.0)


def test_soft_penalties_increase_toward_hard_limits():
    tool = load_tool()

    comfortable = tool.score_anatomy(75.0, 20.0, 30.0)
    near_limit = tool.score_anatomy(25.0, 50.0, 75.0)

    assert near_limit.valid is True
    assert near_limit.component_penalties["elbow"] > comfortable.component_penalties["elbow"]
    assert near_limit.component_penalties["wrist_swing"] > comfortable.component_penalties["wrist_swing"]
    assert near_limit.component_penalties["forearm_twist"] > comfortable.component_penalties["forearm_twist"]
    assert near_limit.total_penalty > comfortable.total_penalty
    assert any("comfort" in reason for reason in near_limit.reasons)

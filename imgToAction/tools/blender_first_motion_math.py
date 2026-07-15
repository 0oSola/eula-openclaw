"""Pure-Python geometry and anatomical scoring for the Blender-first arm POC.

Vectors are represented as three-item tuples. This module intentionally has no
dependency on Blender's ``bpy`` or ``mathutils`` modules so candidate geometry
can be tested and ranked outside Blender.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable


Vector = tuple[float, float, float]
EPSILON = 1e-9

# Elbow comfort matches the thinking-motion G13 acceptance range. A signed
# angle below zero represents reversal; 175 degrees guards near-hyperextension.
ELBOW_HARD_MIN_DEG = 0.0
ELBOW_HARD_MAX_DEG = 175.0
ELBOW_COMFORT_MIN_DEG = 55.0
ELBOW_COMFORT_MAX_DEG = 100.0

# G17 rejects wrist bends above 55 degrees. The lower comfort bound keeps the
# visible wrist close to neutral before the hard visual break occurs.
WRIST_SWING_COMFORT_MAX_DEG = 35.0
WRIST_SWING_HARD_MAX_DEG = 55.0

# Axial forearm rotation should carry palm orientation without approaching an
# implausible full quarter turn. Remaining requested twist is left to the wrist.
FOREARM_TWIST_COMFORT_MAX_DEG = 45.0
FOREARM_TWIST_HARD_MAX_DEG = 80.0

CONTINUITY_FLIP_PENALTY = 10.0


class UnreachableTargetError(ValueError):
    """Raised when strict two-bone reach is requested for an invalid target."""


@dataclass(frozen=True)
class ReachResult:
    root: Vector
    requested_target: Vector
    end: Vector
    reachable: bool
    clamped: bool
    original_distance: float
    solved_distance: float
    min_reach: float
    max_reach: float


@dataclass(frozen=True)
class TwoBoneSolution:
    root: Vector
    elbow: Vector
    end: Vector
    reach: ReachResult


@dataclass(frozen=True)
class TwistAllocation:
    requested_twist_deg: float
    forearm_twist_deg: float
    wrist_twist_deg: float


@dataclass(frozen=True)
class AnatomyScore:
    valid: bool
    total_penalty: float
    component_penalties: dict[str, float]
    measurements: dict[str, float]
    reasons: tuple[str, ...]


def _vector(value: Iterable[float]) -> Vector:
    components = tuple(float(component) for component in value)
    if len(components) != 3:
        raise ValueError("Expected a three-component vector")
    if not all(math.isfinite(component) for component in components):
        raise ValueError("Vector components must be finite")
    return components


def vector_add(left: Iterable[float], right: Iterable[float]) -> Vector:
    a = _vector(left)
    b = _vector(right)
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vector_subtract(left: Iterable[float], right: Iterable[float]) -> Vector:
    a = _vector(left)
    b = _vector(right)
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vector_scale(value: Iterable[float], scale: float) -> Vector:
    vector = _vector(value)
    scalar = float(scale)
    if not math.isfinite(scalar):
        raise ValueError("Scale must be finite")
    return (vector[0] * scalar, vector[1] * scalar, vector[2] * scalar)


def dot(left: Iterable[float], right: Iterable[float]) -> float:
    a = _vector(left)
    b = _vector(right)
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(left: Iterable[float], right: Iterable[float]) -> Vector:
    a = _vector(left)
    b = _vector(right)
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def length(value: Iterable[float]) -> float:
    vector = _vector(value)
    return math.sqrt(dot(vector, vector))


def normalize(value: Iterable[float]) -> Vector:
    vector = _vector(value)
    magnitude = length(vector)
    if magnitude <= EPSILON:
        raise ValueError("Cannot normalize a zero-length vector")
    return vector_scale(vector, 1.0 / magnitude)


def project_onto_plane(value: Iterable[float], plane_normal: Iterable[float]) -> Vector:
    vector = _vector(value)
    normal = normalize(plane_normal)
    return vector_subtract(vector, vector_scale(normal, dot(vector, normal)))


def signed_angle(
    start: Iterable[float],
    end: Iterable[float],
    axis: Iterable[float],
) -> float:
    """Return the signed angle in degrees from ``start`` to ``end`` about ``axis``."""

    axis_unit = normalize(axis)
    start_plane = normalize(project_onto_plane(start, axis_unit))
    end_plane = normalize(project_onto_plane(end, axis_unit))
    sine = dot(axis_unit, cross(start_plane, end_plane))
    cosine = max(-1.0, min(1.0, dot(start_plane, end_plane)))
    return math.degrees(math.atan2(sine, cosine))


def clamped_two_bone_reach(
    root: Iterable[float],
    target: Iterable[float],
    upper_length: float,
    lower_length: float,
    *,
    reject_unreachable: bool = False,
) -> ReachResult:
    """Clamp a target to the closed reach interval, or reject it in strict mode."""

    root_vector = _vector(root)
    target_vector = _vector(target)
    upper = float(upper_length)
    lower = float(lower_length)
    if not math.isfinite(upper) or not math.isfinite(lower) or upper <= 0.0 or lower <= 0.0:
        raise ValueError("Two-bone segment lengths must be finite and positive")

    delta = vector_subtract(target_vector, root_vector)
    target_distance = length(delta)
    min_reach = abs(upper - lower)
    max_reach = upper + lower
    reachable = min_reach - EPSILON <= target_distance <= max_reach + EPSILON
    if not reachable and reject_unreachable:
        raise UnreachableTargetError(
            f"Target distance {target_distance:.6g} is outside the two-bone reach interval "
            f"[{min_reach:.6g}, {max_reach:.6g}]"
        )

    solved_distance = min(max(target_distance, min_reach), max_reach)
    if target_distance <= EPSILON:
        direction = (1.0, 0.0, 0.0)
    else:
        direction = vector_scale(delta, 1.0 / target_distance)
    end = vector_add(root_vector, vector_scale(direction, solved_distance))
    return ReachResult(
        root=root_vector,
        requested_target=target_vector,
        end=end,
        reachable=reachable,
        clamped=not reachable,
        original_distance=target_distance,
        solved_distance=solved_distance,
        min_reach=min_reach,
        max_reach=max_reach,
    )


def _perpendicular_direction(axis: Vector, preferred: Iterable[float] | None = None) -> Vector:
    if preferred is not None:
        projected = project_onto_plane(preferred, axis)
        if length(projected) > EPSILON:
            return normalize(projected)
    fallback = min(((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), key=lambda basis: abs(dot(axis, basis)))
    return normalize(project_onto_plane(fallback, axis))


def elbow_candidates(
    root: Iterable[float],
    end: Iterable[float],
    upper_length: float,
    lower_length: float,
    pole: Iterable[float] | None = None,
) -> tuple[Vector, Vector]:
    """Return the two mirrored elbow locations for a reachable end point."""

    root_vector = _vector(root)
    end_vector = _vector(end)
    axis_delta = vector_subtract(end_vector, root_vector)
    distance_to_end = length(axis_delta)
    if distance_to_end <= EPSILON:
        raise ValueError("Two-bone end must differ from its root")
    axis = normalize(axis_delta)
    upper = float(upper_length)
    lower = float(lower_length)
    if distance_to_end < abs(upper - lower) - EPSILON or distance_to_end > upper + lower + EPSILON:
        raise UnreachableTargetError("End point must be clamped before computing elbow candidates")

    along = (upper * upper - lower * lower + distance_to_end * distance_to_end) / (2.0 * distance_to_end)
    height = math.sqrt(max(0.0, upper * upper - along * along))
    midpoint = vector_add(root_vector, vector_scale(axis, along))
    preferred = vector_subtract(_vector(pole), root_vector) if pole is not None else None
    perpendicular = _perpendicular_direction(axis, preferred)
    offset = vector_scale(perpendicular, height)
    return vector_add(midpoint, offset), vector_subtract(midpoint, offset)


def elbow_side(
    root: Iterable[float],
    end: Iterable[float],
    elbow: Iterable[float],
    pole: Iterable[float],
) -> float:
    """Return a positive value when the elbow lies on the pole-facing side."""

    root_vector = _vector(root)
    axis = vector_subtract(end, root_vector)
    elbow_offset = project_onto_plane(vector_subtract(elbow, root_vector), axis)
    pole_offset = project_onto_plane(vector_subtract(pole, root_vector), axis)
    return dot(elbow_offset, pole_offset)


def continuity_score(
    candidate: Iterable[float],
    previous: Iterable[float],
    root: Iterable[float],
    end: Iterable[float],
) -> float:
    """Score elbow displacement and strongly penalize a mirrored-plane flip."""

    candidate_vector = _vector(candidate)
    previous_vector = _vector(previous)
    root_vector = _vector(root)
    axis = vector_subtract(end, root_vector)
    displacement = length(vector_subtract(candidate_vector, previous_vector))
    candidate_radial = project_onto_plane(vector_subtract(candidate_vector, root_vector), axis)
    previous_radial = project_onto_plane(vector_subtract(previous_vector, root_vector), axis)
    flipped = length(candidate_radial) > EPSILON and length(previous_radial) > EPSILON and dot(candidate_radial, previous_radial) < 0.0
    return displacement + (CONTINUITY_FLIP_PENALTY if flipped else 0.0)


def select_elbow_candidate(
    candidates: Iterable[Iterable[float]],
    root: Iterable[float],
    end: Iterable[float],
    pole: Iterable[float],
    previous_elbow: Iterable[float] | None = None,
) -> Vector:
    choices = tuple(_vector(candidate) for candidate in candidates)
    if len(choices) != 2:
        raise ValueError("Exactly two elbow candidates are required")

    def candidate_score(candidate: Vector) -> tuple[float, float]:
        continuity = 0.0
        if previous_elbow is not None:
            continuity = continuity_score(candidate, previous_elbow, root, end)
        pole_alignment = elbow_side(root, end, candidate, pole)
        return continuity, -pole_alignment

    return min(choices, key=candidate_score)


def solve_two_bone(
    root: Iterable[float],
    target: Iterable[float],
    upper_length: float,
    lower_length: float,
    pole: Iterable[float],
    *,
    previous_elbow: Iterable[float] | None = None,
    reject_unreachable: bool = False,
) -> TwoBoneSolution:
    reach = clamped_two_bone_reach(
        root,
        target,
        upper_length,
        lower_length,
        reject_unreachable=reject_unreachable,
    )
    candidates = elbow_candidates(reach.root, reach.end, upper_length, lower_length, pole)
    elbow = select_elbow_candidate(candidates, reach.root, reach.end, pole, previous_elbow)
    return TwoBoneSolution(root=reach.root, elbow=elbow, end=reach.end, reach=reach)


def allocate_forearm_twist(requested_twist_deg: float) -> TwistAllocation:
    """Put bounded axial rotation on the forearm and leave excess for the wrist."""

    requested = float(requested_twist_deg)
    if not math.isfinite(requested):
        raise ValueError("Requested twist must be finite")
    forearm = max(-FOREARM_TWIST_HARD_MAX_DEG, min(FOREARM_TWIST_HARD_MAX_DEG, requested))
    return TwistAllocation(requested, forearm, requested - forearm)


def _range_penalty(value: float, comfort_min: float, comfort_max: float, hard_min: float, hard_max: float) -> float:
    if comfort_min <= value <= comfort_max:
        return 0.0
    if value < comfort_min:
        span = max(EPSILON, comfort_min - hard_min)
        return ((comfort_min - value) / span) ** 2
    span = max(EPSILON, hard_max - comfort_max)
    return ((value - comfort_max) / span) ** 2


def _absolute_penalty(value: float, comfort_max: float, hard_max: float) -> float:
    magnitude = abs(value)
    if magnitude <= comfort_max:
        return 0.0
    span = max(EPSILON, hard_max - comfort_max)
    return ((magnitude - comfort_max) / span) ** 2


def score_anatomy(
    elbow_angle_deg: float,
    wrist_swing_deg: float,
    forearm_twist_deg: float,
) -> AnatomyScore:
    """Apply hard validity limits and soft comfort penalties to an arm pose."""

    elbow = float(elbow_angle_deg)
    wrist = float(wrist_swing_deg)
    twist = float(forearm_twist_deg)
    if not all(math.isfinite(value) for value in (elbow, wrist, twist)):
        raise ValueError("Anatomical measurements must be finite")

    penalties = {
        "elbow": _range_penalty(
            elbow,
            ELBOW_COMFORT_MIN_DEG,
            ELBOW_COMFORT_MAX_DEG,
            ELBOW_HARD_MIN_DEG,
            ELBOW_HARD_MAX_DEG,
        ),
        "wrist_swing": _absolute_penalty(wrist, WRIST_SWING_COMFORT_MAX_DEG, WRIST_SWING_HARD_MAX_DEG),
        "forearm_twist": _absolute_penalty(twist, FOREARM_TWIST_COMFORT_MAX_DEG, FOREARM_TWIST_HARD_MAX_DEG),
    }
    reasons: list[str] = []
    valid = True

    if elbow < ELBOW_HARD_MIN_DEG:
        valid = False
        reasons.append(f"Elbow is reversed below the {ELBOW_HARD_MIN_DEG:.0f} degree hard limit")
    elif elbow > ELBOW_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Elbow exceeds the {ELBOW_HARD_MAX_DEG:.0f} degree extension hard limit")
    elif penalties["elbow"] > 0.0:
        reasons.append(
            f"Elbow is outside the {ELBOW_COMFORT_MIN_DEG:.0f}-{ELBOW_COMFORT_MAX_DEG:.0f} degree comfort range"
        )

    if abs(wrist) > WRIST_SWING_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Wrist swing exceeds the {WRIST_SWING_HARD_MAX_DEG:.0f} degree hard limit")
    elif penalties["wrist_swing"] > 0.0:
        reasons.append(f"Wrist swing is outside the +/-{WRIST_SWING_COMFORT_MAX_DEG:.0f} degree comfort range")

    if abs(twist) > FOREARM_TWIST_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Forearm twist exceeds the +/-{FOREARM_TWIST_HARD_MAX_DEG:.0f} degree hard limit")
    elif penalties["forearm_twist"] > 0.0:
        reasons.append(f"Forearm twist is outside the +/-{FOREARM_TWIST_COMFORT_MAX_DEG:.0f} degree comfort range")

    return AnatomyScore(
        valid=valid,
        total_penalty=sum(penalties.values()),
        component_penalties=penalties,
        measurements={
            "elbow_angle_deg": elbow,
            "wrist_swing_deg": wrist,
            "forearm_twist_deg": twist,
        },
        reasons=tuple(reasons),
    )

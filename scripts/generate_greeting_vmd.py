from __future__ import annotations

import math
import struct
from dataclasses import dataclass
from pathlib import Path


OUTPUT = Path("MMD/motions/entrance_wave_greeting_smile.vmd")


@dataclass(frozen=True)
class BoneFrame:
    name: str
    frame: int
    position: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)


@dataclass(frozen=True)
class MorphFrame:
    name: str
    frame: int
    weight: float


def encode_fixed(text: str, length: int) -> bytes:
    raw = text.encode("shift_jis", errors="ignore")
    return raw[:length].ljust(length, b"\0")


def quat_from_euler(rx: float, ry: float, rz: float) -> tuple[float, float, float, float]:
    cx, sx = math.cos(rx / 2), math.sin(rx / 2)
    cy, sy = math.cos(ry / 2), math.sin(ry / 2)
    cz, sz = math.cos(rz / 2), math.sin(rz / 2)
    return (
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
        cx * cy * cz - sx * sy * sz,
    )


def deg(x: float) -> float:
    return math.radians(x)


def interpolation() -> bytes:
    # Standard gentle Bezier-ish defaults for MMD VMD bone frames.
    values = [20, 20, 20, 20, 107, 107, 107, 107] * 8
    return bytes(values[:64])


def bone(name: str, frame: int, pos=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0)) -> BoneFrame:
    return BoneFrame(name=name, frame=frame, position=pos, rotation=quat_from_euler(*rot))


def build_motion() -> tuple[list[BoneFrame], list[MorphFrame]]:
    bones: list[BoneFrame] = []

    # Entry and settle: center slides in, with small vertical bounce.
    for frame, z, y in [(0, -3.0, 0.0), (18, -1.8, 0.05), (36, -0.65, -0.02), (52, 0.0, 0.0), (90, 0.0, 0.0)]:
        bones.append(bone("センター", frame, (0.0, y, z)))
    for frame, rz in [(0, 0), (24, -4), (52, 2), (72, 0), (90, 0)]:
        bones.append(bone("下半身", frame, rot=(0, 0, deg(rz))))

    # Friendly body language.
    for frame, rx, rz in [(0, 0, 0), (32, deg(-4), deg(-2)), (52, deg(-7), deg(3)), (72, deg(-3), deg(-2)), (90, 0, 0)]:
        bones.append(bone("上半身", frame, rot=(rx, 0, rz)))
        bones.append(bone("上半身2", frame, rot=(rx * 0.6, 0, rz * 0.7)))
    for frame, rx, ry, rz in [(0, 0, 0, 0), (36, deg(-2), deg(-5), deg(3)), (52, deg(-5), deg(-8), deg(5)), (72, deg(-3), deg(5), deg(-4)), (90, 0, 0, 0)]:
        bones.append(bone("頭", frame, rot=(rx, ry, rz)))
        bones.append(bone("首", frame, rot=(rx * 0.5, ry * 0.5, rz * 0.5)))

    # Right-hand wave: raise, wave twice, settle.
    right_arm = [
        (0, 0, 0, 0),
        (26, deg(-18), 0, deg(-38)),
        (40, deg(-34), deg(-6), deg(-72)),
        (52, deg(-38), deg(-10), deg(-78)),
        (62, deg(-34), deg(10), deg(-65)),
        (72, deg(-38), deg(-10), deg(-78)),
        (84, deg(-14), 0, deg(-35)),
        (96, 0, 0, 0),
    ]
    for frame, rx, ry, rz in right_arm:
        bones.append(bone("右肩", frame, rot=(deg(-4) if frame else 0, 0, deg(-5) if frame else 0)))
        bones.append(bone("右腕", frame, rot=(rx, ry, rz)))

    right_elbow = [
        (0, 0, 0, 0),
        (30, deg(-52), 0, deg(-4)),
        (42, deg(-82), 0, deg(-8)),
        (52, deg(-72), 0, deg(18)),
        (62, deg(-84), 0, deg(-18)),
        (72, deg(-72), 0, deg(18)),
        (84, deg(-42), 0, deg(0)),
        (96, 0, 0, 0),
    ]
    for frame, rx, ry, rz in right_elbow:
        bones.append(bone("右ひじ", frame, rot=(rx, ry, rz)))

    for frame, rz in [(0, 0), (42, 12), (52, -24), (62, 24), (72, -18), (84, 8), (96, 0)]:
        bones.append(bone("右手首", frame, rot=(deg(6), deg(0), deg(rz))))

    # Left arm relaxes naturally.
    for frame, rx, rz in [(0, 0, 0), (36, deg(4), deg(8)), (56, deg(6), deg(10)), (90, 0, 0)]:
        bones.append(bone("左肩", frame, rot=(0, 0, deg(3) if frame else 0)))
        bones.append(bone("左腕", frame, rot=(rx, 0, rz)))
        bones.append(bone("左ひじ", frame, rot=(deg(-6) if frame else 0, 0, 0)))
        bones.append(bone("左手首", frame, rot=(0, 0, deg(-4) if frame else 0)))

    # Optional leg accents for models with standard leg bones.
    for side, sign in [("右", 1), ("左", -1)]:
        for frame, rx, rz in [(0, 0, 0), (18, deg(-5), deg(2 * sign)), (36, deg(4), deg(-2 * sign)), (52, 0, 0), (90, 0, 0)]:
            bones.append(bone(f"{side}足", frame, rot=(rx, 0, rz)))
        for frame, rx in [(0, 0), (18, deg(7)), (36, deg(4)), (52, 0), (90, 0)]:
            bones.append(bone(f"{side}ひざ", frame, rot=(rx, 0, 0)))

    morphs = []
    smile_names = ["笑い", "にこり", "口角上げ", "笑顔"]
    for name in smile_names:
        for frame, weight in [(0, 0.0), (28, 0.25), (42, 0.75), (72, 0.9), (96, 0.55)]:
            morphs.append(MorphFrame(name, frame, weight))
    for name in ["まばたき", "笑い目"]:
        for frame, weight in [(0, 0.0), (48, 0.0), (54, 0.35), (60, 0.0), (96, 0.0)]:
            morphs.append(MorphFrame(name, frame, weight))

    bones.sort(key=lambda item: (item.name, item.frame))
    morphs.sort(key=lambda item: (item.name, item.frame))
    return bones, morphs


def write_vmd(path: Path, bones: list[BoneFrame], morphs: list[MorphFrame]) -> None:
    data = bytearray()
    data += encode_fixed("Vocaloid Motion Data 0002", 30)
    data += encode_fixed("GreetingWave", 20)
    data += struct.pack("<I", len(bones))
    interp = interpolation()
    for frame in bones:
        data += encode_fixed(frame.name, 15)
        data += struct.pack("<I", frame.frame)
        data += struct.pack("<3f", *frame.position)
        data += struct.pack("<4f", *frame.rotation)
        data += interp
    data += struct.pack("<I", len(morphs))
    for frame in morphs:
        data += encode_fixed(frame.name, 15)
        data += struct.pack("<If", frame.frame, frame.weight)
    data += struct.pack("<I", 0)  # cameras
    data += struct.pack("<I", 0)  # lights
    data += struct.pack("<I", 0)  # self shadows
    data += struct.pack("<I", 0)  # IK display frames
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def main() -> None:
    bones, morphs = build_motion()
    write_vmd(OUTPUT, bones, morphs)
    print(f"wrote {OUTPUT} ({len(bones)} bone frames, {len(morphs)} morph frames)")


if __name__ == "__main__":
    main()

import os
import json
import cv2
import numpy as np


INPUT_IMAGE = "sprite2.png"
OUTPUT_DIR = "sprite_output"
JSON_PATH = os.path.join(OUTPUT_DIR, "sprites.json")

# 是否保留橙色框
KEEP_BORDER = False

# 导出时向内收缩，避免把橙色线框一起裁进去
INNER_PADDING = 6

# 过滤过小噪点
MIN_BOX_W = 24
MIN_BOX_H = 24
MIN_AREA = 800


def ensure_dir(path: str):
    if not os.path.exists(path):
        os.makedirs(path)


def load_image_rgba(path: str):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"无法读取图片: {path}")

    if img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    return img


def detect_orange_boxes(img_rgba: np.ndarray):
    """
    检测橙色分割线框，返回候选框列表 [x, y, w, h]
    """
    bgr = cv2.cvtColor(img_rgba, cv2.COLOR_BGRA2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # 橙色阈值，可按实际图微调
    lower_orange = np.array([8, 80, 120], dtype=np.uint8)
    upper_orange = np.array([30, 255, 255], dtype=np.uint8)

    mask = cv2.inRange(hsv, lower_orange, upper_orange)

    # 适配虚线框：先膨胀连通，再闭运算补断点
    kernel1 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    kernel2 = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    mask = cv2.dilate(mask, kernel1, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel2, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        area = w * h
        if w >= MIN_BOX_W and h >= MIN_BOX_H and area >= MIN_AREA:
            boxes.append((x, y, w, h))

    return boxes, mask


def sort_boxes_reading_order(boxes):
    """
    按从上到下、从左到右排序
    """
    if not boxes:
        return []

    boxes = sorted(boxes, key=lambda b: (b[1], b[0]))

    rows = []
    row_threshold = 20

    for box in boxes:
        x, y, w, h = box
        placed = False
        for row in rows:
            row_y = row[0][1]
            if abs(y - row_y) <= row_threshold:
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])

    sorted_boxes = []
    for row in rows:
        row.sort(key=lambda b: b[0])
        sorted_boxes.extend(row)

    return sorted_boxes


def crop_box(img_rgba: np.ndarray, box, keep_border=False, inner_padding=6):
    x, y, w, h = box

    if not keep_border:
        x += inner_padding
        y += inner_padding
        w -= inner_padding * 2
        h -= inner_padding * 2

    x = max(0, x)
    y = max(0, y)
    w = max(1, w)
    h = max(1, h)

    x2 = min(img_rgba.shape[1], x + w)
    y2 = min(img_rgba.shape[0], y + h)

    crop = img_rgba[y:y2, x:x2].copy()
    return crop, (x, y, x2 - x, y2 - y)


def trim_transparent(crop_rgba: np.ndarray):
    """
    去掉透明边缘，减少空白
    """
    alpha = crop_rgba[:, :, 3]
    coords = cv2.findNonZero(alpha)
    if coords is None:
        return crop_rgba, (0, 0, crop_rgba.shape[1], crop_rgba.shape[0])

    x, y, w, h = cv2.boundingRect(coords)
    trimmed = crop_rgba[y:y+h, x:x+w].copy()
    return trimmed, (x, y, w, h)


def main():
    ensure_dir(OUTPUT_DIR)

    img = load_image_rgba(INPUT_IMAGE)
    boxes, mask = detect_orange_boxes(img)
    boxes = sort_boxes_reading_order(boxes)

    debug_mask_path = os.path.join(OUTPUT_DIR, "_debug_orange_mask.png")
    cv2.imwrite(debug_mask_path, mask)

    debug_preview = img.copy()
    for i, (x, y, w, h) in enumerate(boxes):
        cv2.rectangle(debug_preview, (x, y), (x + w, y + h), (0, 255, 0, 255), 2)
        cv2.putText(
            debug_preview,
            str(i),
            (x + 6, y + 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 0, 255),
            2,
            cv2.LINE_AA
        )

    debug_preview_path = os.path.join(OUTPUT_DIR, "_debug_detected_boxes.png")
    cv2.imwrite(debug_preview_path, debug_preview)

    metadata = {
        "source": INPUT_IMAGE,
        "count": 0,
        "sprites": []
    }

    for i, box in enumerate(boxes):
        crop, cropped_rect = crop_box(
            img,
            box,
            keep_border=KEEP_BORDER,
            inner_padding=INNER_PADDING
        )

        trimmed, trim_rect = trim_transparent(crop)

        name = f"sprite_{i:03d}.png"
        out_path = os.path.join(OUTPUT_DIR, name)
        cv2.imwrite(out_path, trimmed)

        bx, by, bw, bh = box
        cx, cy, cw, ch = cropped_rect
        tx, ty, tw, th = trim_rect

        metadata["sprites"].append({
            "id": i,
            "file": name,
            "box_raw": {"x": int(bx), "y": int(by), "w": int(bw), "h": int(bh)},
            "box_cropped": {"x": int(cx), "y": int(cy), "w": int(cw), "h": int(ch)},
            "trim_in_crop": {"x": int(tx), "y": int(ty), "w": int(tw), "h": int(th)},
            "final_size": {"w": int(trimmed.shape[1]), "h": int(trimmed.shape[0])}
        })

    metadata["count"] = len(metadata["sprites"])

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"完成，共导出 {metadata['count']} 个精灵。")
    print(f"输出目录: {OUTPUT_DIR}")
    print(f"调试图: {debug_preview_path}")
    print(f"配置文件: {JSON_PATH}")


if __name__ == "__main__":
    main()
import os
from PIL import Image

def safe_makedirs(path):
    if not os.path.exists(path):
        os.makedirs(path)

def split_full_sprites(image_path, output_root="exported_ui_kit"):
    """
    精确切割并保存原图中的所有UI组件。
    分类保存在子文件夹中。
    """
    safe_makedirs(output_root)

    try:
        with Image.open(image_path) as img:
            print(f"--- 正在处理原始图片: {image_path} ---")
            img_w, img_h = img.size

            # ========================================================
            # PART 1: 单个大组件 (对话框、面板、输入栏)
            # 格式: [x, y, width, height, "子文件夹/文件名"]
            # ========================================================
            parts_manifest = [
                # Section 1 & 2: Dialogue Bubbles
                [10, 78, 215, 155, "bubbles/large_L_glow.png"],
                [228, 78, 145, 130, "bubbles/large_R_plain.png"],
                [10, 305, 185, 135, "bubbles/med_L_plain.png"],
                [200, 305, 185, 135, "bubbles/med_R_target.png"],
                [10, 508, 175, 120, "bubbles/small_L_alert.png"],
                [188, 508, 175, 120, "bubbles/small_R_error.png"],

                # Section 2: Right Panels
                [392, 45, 190, 185, "panels/panel_idea.png"],
                [392, 245, 190, 205, "panels/panel_brain.png"],
                [392, 465, 190, 210, "panels/panel_audio.png"],

                # Section 4: Input Bar and its sub-buttons
                [10, 745, 940, 68, "input_bar/full_bar.png"],
                #[685, 758, 55, 42, "input_bar/btn_send.png"], # 视需切割，也可直接使用全栏
                #[805, 758, 140, 42, "input_bar/btn_settings.png"] # 视需切割
            ]

            processed_count = 0

            print("-> 正在切割对话框、面板和输入栏...")
            for part in parts_manifest:
                x, y, w, h, rel_path = part
                # 创建子文件夹
                sub_dir = os.path.join(output_root, os.path.dirname(rel_path))
                safe_makedirs(sub_dir)
                # 裁剪
                crop_area = (x, y, x + w, y + h)
                sprite = img.crop(crop_area)
                # 保存
                full_save_path = os.path.join(output_root, rel_path)
                sprite.save(full_save_path)
                processed_count += 1

            # ========================================================
            # PART 2: 批量网格扫描 (密集图标区)
            # ========================================================
            
            # --- Section 3: 功能图标区 (约40x40网格) ---
            print("-> 正在扫描 Section 3 的功能图标 (行: 功能, 状态, 操作)...")
            icon_sub_dir = os.path.join(output_root, "icons")
            safe_makedirs(icon_sub_dir)
            
            # 定义扫描网格参数：起始 (X, Y), 每格宽, 每格高, 行数, 列数
            grid_configs = [
                # [StartX, StartY, GridW, GridH, Rows, Cols, "prefix"]
                [595, 68, 50, 48, 1, 9, "fnc_"],  # 主功能行 (Menu, Chat, etc.)
                [600, 160, 45, 30, 1, 9, "status_"], # 状态指示灯 (多色点, 进度)
                [598, 242, 50, 50, 1, 8, "opr_"]  # 操作图标行 (Send, Mic, etc.)
            ]
            
            for config in grid_configs:
                sx, sy, gw, gh, rows, cols, prefix = config
                for r in range(rows):
                    for c in range(cols):
                        cx = sx + (c * gw)
                        cy = sy + (r * gh)
                        # 确保不越界
                        if cx + gw > img_w or cy + gh > img_h: continue
                        
                        crop_area = (cx, cy, cx + gw, cy + gh)
                        sprite = img.crop(crop_area)
                        
                        fname = f"{prefix}icon_{r}_{c}.png"
                        sprite.save(os.path.join(icon_sub_dir, fname))
                        processed_count += 1

            # --- Section 3: 特殊密集区 (表情, 动作, 文件, 头像) ---
            print("-> 正在扫描 Section 3 的密集区 (表情, 动作, 文件图标, 头像)...")
            special_configs = [
                [598, 335, 45, 45, 1, 6, "emoji_"],    # 表情包
                [595, 420, 50, 50, 1, 8, "action_"],   # 动作人像
                [595, 508, 48, 48, 1, 12, "file_"],    # 文件/更多功能图标
                [596, 590, 50, 50, 1, 7, "avatar_"]    # 模型选择器头像
            ]
            
            for config in special_configs:
                sx, sy, gw, gh, rows, cols, prefix = config
                for r in range(rows):
                    for c in range(cols):
                        cx = sx + (c * gw)
                        cy = sy + (r * gh)
                        if cx + gw > img_w or cy + gh > img_h: continue
                        crop_area = (cx, cy, cx + gw, cy + gh)
                        sprite = img.crop(crop_area)
                        fname = f"{prefix}{r}_{c}.png"
                        sprite.save(os.path.join(icon_sub_dir, fname))
                        processed_count += 1

            # --- Section 3: 小型控件 (拉条, 开关) ---
            print("-> 正在扫描 Section 3 的小型控件...")
            controls_sub_dir = os.path.join(output_root, "controls")
            safe_makedirs(controls_sub_dir)
            control_configs = [
                [600, 692, 60, 30, 1, 2, "switch_"],    # 开关
                [695, 698, 100, 18, 1, 1, "slider_"]     # 拉条 (整体)
                #[820, 690, 40, 40, 1, 4, "ctrl_dots_"] # 视需切割单独的小点
            ]
            for config in control_configs:
                sx, sy, gw, gh, rows, cols, prefix = config
                for r in range(rows):
                    for c in range(cols):
                        cx = sx + (c * gw)
                        cy = sy + (r * gh)
                        if cx + gw > img_w or cy + gh > img_h: continue
                        crop_area = (cx, cy, cx + gw, cy + gh)
                        sprite = img.crop(crop_area)
                        fname = f"{prefix}{r}_{c}.png"
                        sprite.save(os.path.join(controls_sub_dir, fname))
                        processed_count += 1

            # --- Section 5: 其他装饰元素 (全扫描) ---
            print("-> 正在扫描 Section 5 的装饰元素 (光圈, 花瓣)...")
            deco_sub_dir = os.path.join(output_root, "decorations")
            safe_makedirs(deco_sub_dir)
            
            deco_configs = [
                [15, 860, 105, 105, 1, 3, "halo_"],     # 霓虹光圈
                [390, 880, 55, 55, 1, 1, "loader_"],    # 加载点
                [540, 872, 110, 30, 1, 1, "pointer_"],  # '>' 控件
                [765, 860, 220, 120, 1, 1, "petals_"]   # 粉色花瓣 (整体)
            ]
            
            # 将 Section 5 底部一排超小的功能小图标单独扫描
            # 它们在 > 后面，花瓣前面
            small_deco_config = [615, 875, 45, 40, 1, 3, "small_deco_"]
            
            all_deco_configs = deco_configs + [small_deco_config]
            
            for config in all_deco_configs:
                sx, sy, gw, gh, rows, cols, prefix = config
                for r in range(rows):
                    for c in range(cols):
                        cx = sx + (c * gw)
                        cy = sy + (r * gh)
                        if cx + gw > img_w or cy + gh > img_h: continue
                        crop_area = (cx, cy, cx + gw, cy + gh)
                        sprite = img.crop(crop_area)
                        fname = f"{prefix}{r}_{c}.png"
                        sprite.save(os.path.join(deco_sub_dir, fname))
                        processed_count += 1

            # ========================================================
            print(f"--- 切割完成 ---")
            print(f"成功将全图切割为 {processed_count} 个单独的PNG文件。")
            print(f"所有文件都已整齐保存在 '{output_root}' 的子文件夹中。")

    except FileNotFoundError:
        print(f"错误: 找不到文件 '{image_path}'。请确保图片文件名为 'sprite.jpg' 并放置在脚本同目录下。")
    except Exception as e:
        print(f"发生不可预料的错误: {e}")

if __name__ == "__main__":
    # 使用你提供的图片，请确保文件名一致
    # 如果图片是 PNG 格式，请将这里改为 "sprite.png"
    split_full_sprites("sprite.png")
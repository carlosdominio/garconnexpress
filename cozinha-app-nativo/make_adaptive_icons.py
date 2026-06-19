from PIL import Image

src_path = "logo_alta_qualidade.png.png"
bg_dest = "assets/icon-background.png"
fg_dest = "assets/icon-foreground.png"
icon_dest = "assets/icon.png"

# Load image
img = Image.open(src_path).convert("RGBA")
width, height = img.size

# Extract background color from top-left pixel
bg_color = img.getpixel((0, 0))
r, g, b, a = bg_color
print(f"Detected background color: R={r}, G={g}, B={b}, A={a}")

# 1. Create assets/icon-background.png (1024x1024 solid background color)
bg_canvas = Image.new("RGBA", (1024, 1024), (r, g, b, 255))
bg_canvas.save(bg_dest, "PNG")
print("Saved assets/icon-background.png")

# 2. Chroma key the original image to make background transparent for foreground
# If the background is opaque, remove the background pixels
datas = img.getdata()
new_data = []
for item in datas:
    # Check color distance from the background color
    dist = abs(item[0] - r) + abs(item[1] - g) + abs(item[2] - b)
    if dist < 45:  # Tolerance threshold for background extraction
        new_data.append((255, 255, 255, 0))
    else:
        new_data.append(item)

key_img = Image.new("RGBA", img.size)
key_img.putdata(new_data)

# 3. Create assets/icon-foreground.png
fg_canvas = Image.new("RGBA", (1024, 1024), (255, 255, 255, 0))

bbox = key_img.getbbox()
if bbox:
    key_img = key_img.crop(bbox)

scale = 0.75
orig_w, orig_h = key_img.size
aspect = orig_w / float(orig_h)

target_size = int(1024 * scale)
if aspect > 1:
    logo_w = target_size
    logo_h = int(target_size / aspect)
else:
    logo_h = target_size
    logo_w = int(target_size * aspect)

logo_resized = key_img.resize((logo_w, logo_h), Image.Resampling.LANCZOS)
x = (1024 - logo_w) // 2
y = (1024 - logo_h) // 2

fg_canvas.paste(logo_resized, (x, y), logo_resized)
fg_canvas.save(fg_dest, "PNG")
print("Saved assets/icon-foreground.png")

# 4. Generate assets/icon.png (general icon) - padded logo on solid background
icon_canvas = Image.new("RGBA", (1024, 1024), (r, g, b, 255))
icon_canvas.paste(logo_resized, (x, y), logo_resized)
icon_canvas.save(icon_dest, "PNG")
icon_canvas.save("icon.png", "PNG")
print("Saved assets/icon.png and icon.png")

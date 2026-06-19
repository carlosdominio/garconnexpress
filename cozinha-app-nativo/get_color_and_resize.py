from PIL import Image

src_path = "assets/ChatGPT Image 19 de jun. de 2026, 11_03_20.png"
dest_path = "assets/icon.png"
root_dest_path = "icon.png"

# Load image
img = Image.open(src_path)

# Convert to RGBA
img = img.convert("RGBA")

# Get background color from top-left pixel
bg_color = img.getpixel((0, 0))
r, g, b, a = bg_color
hex_color = f"#{r:02x}{g:02x}{b:02x}"
print(f"BACKGROUND_HEX={hex_color}")

# Target size 1024x1024
new_size = 1024
canvas = Image.new("RGBA", (new_size, new_size), bg_color)

# Scale original image to 70% using high quality Lanczos filter
scale = 0.70
logo_w = int(new_size * scale)
logo_h = int(new_size * scale)

# Resize logo with Lanczos resampling
logo_resized = img.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

# Center it on the canvas
x = (new_size - logo_w) // 2
y = (new_size - logo_h) // 2
canvas.paste(logo_resized, (x, y), logo_resized if a < 255 else None)

# Save high quality PNGs
canvas.save(dest_path, "PNG", quality=100)
canvas.save(root_dest_path, "PNG", quality=100)

print("Icon resized and padded with high quality Lanczos successfully!")

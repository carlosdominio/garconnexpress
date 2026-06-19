Add-Type -AssemblyName System.Drawing
$srcPath = "C:\Users\Admin\.verdent\verdent-projects\new-project\cozinha-app-nativo\assets\ChatGPT Image 19 de jun. de 2026, 11_03_20.png"
$destPath = "C:\Users\Admin\.verdent\verdent-projects\new-project\cozinha-app-nativo\assets\icon.png"
$rootDestPath = "C:\Users\Admin\.verdent\verdent-projects\new-project\cozinha-app-nativo\icon.png"

$srcImg = [System.Drawing.Image]::FromFile($srcPath)
$newWidth = 1024
$newHeight = 1024
$bmp = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
$g = [System.Drawing.Graphics]::FromImage($bmp)

# Read background color from top-left pixel
$srcBmp = New-Object System.Drawing.Bitmap($srcImg)
$bgColor = $srcBmp.GetPixel(0, 0)

# If it is completely transparent, keep it transparent, otherwise fill background
if ($bgColor.A -gt 0) {
    $brush = New-Object System.Drawing.SolidBrush($bgColor)
    $g.FillRectangle($brush, 0, 0, $newWidth, $newHeight)
} else {
    $g.Clear([System.Drawing.Color]::Transparent)
}

# Scale the logo to 62% (making it slightly smaller to have a comfortable margin in Android)
$scale = 0.62
$logoWidth = [int]($newWidth * $scale)
$logoHeight = [int]($newHeight * $scale)
$x = [int](($newWidth - $logoWidth) / 2)
$y = [int](($newHeight - $logoHeight) / 2)

# Set high quality settings
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$g.DrawImage($srcImg, $x, $y, $logoWidth, $logoHeight)

# Clean up
$g.Dispose()
$srcImg.Dispose()
$srcBmp.Dispose()

# Save
$bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($rootDestPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
write-output "Icon resized and padded successfully!"

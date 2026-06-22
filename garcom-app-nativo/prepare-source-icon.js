const sharp = require('sharp');
const fs = require('fs');

async function createMaximizedSourceIcon() {
    try {
        const inputPath = 'icon-original.png';
        const outputPath = 'assets/icon.png';
        const rootOutputPath = 'icon.png';
        
        // Trim transparent padding from the original logo
        const trimmedBuffer = await sharp(inputPath)
            .trim()
            .toBuffer();

        // Save it as a large 1024x1024 source image to feed into capacitor/assets
        await sharp(trimmedBuffer)
            .resize({
                width: 1024,
                height: 1024,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputPath);
            
        // Also save to root
        fs.copyFileSync(outputPath, rootOutputPath);

        console.log('Trimmed and scaled source icon saved to assets/icon.png');
    } catch (e) {
        console.error('Error:', e);
    }
}

createMaximizedSourceIcon();

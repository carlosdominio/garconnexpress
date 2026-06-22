const sharp = require('sharp');
const fs = require('fs');

async function createMaximizedSourceIcon() {
    try {
        const inputPath = 'assets/icon.png';
        const backupPath = 'icon-original.png';
        
        // Backup the original if it hasn't been backed up
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(inputPath, backupPath);
        }

        const sourcePath = fs.existsSync(backupPath) ? backupPath : inputPath;

        // Trim transparent padding from the original logo
        const trimmedBuffer = await sharp(sourcePath)
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
            .toFile(inputPath);
            
        // Also save to root
        fs.copyFileSync(inputPath, 'icon.png');

        console.log('Trimmed and scaled source icon saved to assets/icon.png');
    } catch (e) {
        console.error('Error:', e);
    }
}

createMaximizedSourceIcon();

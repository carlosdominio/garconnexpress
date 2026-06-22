const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function maximizeIcons() {
    try {
        const inputPath = 'icon-original.png';
        const basePath = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

        // Target sizes for legacy Android icons
        const targets = [
            { folder: 'mipmap-mdpi', size: 48 },
            { folder: 'mipmap-hdpi', size: 72 },
            { folder: 'mipmap-xhdpi', size: 96 },
            { folder: 'mipmap-xxhdpi', size: 144 },
            { folder: 'mipmap-xxxhdpi', size: 192 }
        ];

        // 1. Trim transparency and create a buffer
        const trimmedBuffer = await sharp(inputPath)
            .trim()
            .toBuffer();

        // 2. Generate and overwrite the icons in each mipmap folder
        for (const target of targets) {
            const folderPath = path.join(basePath, target.folder);
            
            // Overwrite normal legacy icon
            const destIconPath = path.join(folderPath, 'ic_launcher.png');
            // Overwrite round legacy icon just in case the system prefers it
            const destRoundIconPath = path.join(folderPath, 'ic_launcher_round.png');
            
            if (fs.existsSync(folderPath)) {
                const resized = await sharp(trimmedBuffer)
                    .resize({
                        width: target.size,
                        height: target.size,
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    })
                    .png()
                    .toBuffer();
                
                fs.writeFileSync(destIconPath, resized);
                fs.writeFileSync(destRoundIconPath, resized);
                console.log(`Overwrote ${target.folder} with size ${target.size}x${target.size}`);
            }
        }

        console.log('All legacy icons have been forcefully maximized!');
    } catch (e) {
        console.error('Error:', e);
    }
}

maximizeIcons();

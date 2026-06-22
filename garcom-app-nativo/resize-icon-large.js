const sharp = require('sharp');

async function processIcon() {
    try {
        const inputPath = 'icon-original.png';
        const outputPath = 'icon.png';
        
        // Resize original icon up to 1024x1024 to fill the whole area
        // It will be huge and edge-to-edge.
        await sharp(inputPath)
            .resize({
                width: 1024,
                height: 1024,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputPath);

        console.log('Original icon restored and scaled up as', outputPath);
    } catch (e) {
        console.error('Error:', e);
    }
}

processIcon();

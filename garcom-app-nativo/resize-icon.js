const sharp = require('sharp');
const fs = require('fs');

async function processIcon() {
    try {
        const inputPath = 'icon.png';
        const outputPath = 'icon-adaptive.png';
        
        // Ensure input exists
        if (!fs.existsSync(inputPath)) {
            console.error('File not found:', inputPath);
            return;
        }

        // 1. Resize the original image to 264x264 (safe area)
        const resizedBuffer = await sharp(inputPath)
            .resize({
                width: 264,
                height: 264,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer();

        // 2. Create a 432x432 transparent canvas and composite the resized image in the center
        await sharp({
            create: {
                width: 432,
                height: 432,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 } // transparent background
            }
        })
        .composite([
            {
                input: resizedBuffer,
                gravity: 'center'
            }
        ])
        .png()
        .toFile(outputPath);

        console.log('Icon resized and saved as', outputPath);
    } catch (e) {
        console.error('Error:', e);
    }
}

processIcon();

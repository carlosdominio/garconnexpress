const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const apps = [
    'C:\\Users\\Admin\\.verdent\\verdent-projects\\new-project\\motoboy-app-nativo',
    'C:\\Users\\Admin\\.verdent\\verdent-projects\\new-project\\garcom-app-nativo'
];

// Adaptive Foreground Layer Sizes (108dp base)
const foregroundSizes = {
    'mipmap-mdpi': 108,
    'mipmap-hdpi': 162,
    'mipmap-xhdpi': 216,
    'mipmap-xxhdpi': 324,
    'mipmap-xxxhdpi': 432
};

// We will make the logo take nearly the entire safe zone / mask size
const logoFraction = 96 / 108; 

const legacySizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192
};

async function getBoundingBox(imagePath) {
    const {data, info} = await sharp(imagePath).raw().toBuffer({resolveWithObject: true});
    let minX=info.width, maxX=0, minY=info.height, maxY=0;
    // scan for non-white and non-transparent pixels
    for (let y=0; y<info.height; y++){
        for (let x=0; x<info.width; x++){
            let i = (y*info.width+x)*info.channels;
            let r=data[i], g=data[i+1], b=data[i+2], a=info.channels>3 ? data[i+3] : 255;
            if (a > 10 && (r<240 || g<240 || b<240)) {
                if (x<minX) minX=x;
                if (x>maxX) maxX=x;
                if (y<minY) minY=y;
                if (y>maxY) maxY=y;
            }
        }
    }
    // safety fallback
    if (minX >= maxX || minY >= maxY) return null;
    return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function processApp(appDir) {
    try {
        console.log('Processing:', appDir);
        let iconOriginal = path.join(appDir, 'icon-original.png');
        if (!fs.existsSync(iconOriginal)) {
            iconOriginal = path.join(appDir, 'assets', 'icon.png');
            if (!fs.existsSync(iconOriginal)) {
                console.log('No icon found in', appDir);
                return;
            }
        }

        const box = await getBoundingBox(iconOriginal);
        let trimmedBuffer;
        if (box) {
            console.log(`Cropping exactly to box:`, box);
            trimmedBuffer = await sharp(iconOriginal).extract(box).toBuffer();
        } else {
            console.log(`Fallback to standard trim`);
            trimmedBuffer = await sharp(iconOriginal).trim().toBuffer();
        }

        const resDir = path.join(appDir, 'android', 'app', 'src', 'main', 'res');

        for (const [folder, size] of Object.entries(foregroundSizes)) {
            const outPath = path.join(resDir, folder, 'ic_launcher_foreground.png');
            if (!fs.existsSync(path.join(resDir, folder))) fs.mkdirSync(path.join(resDir, folder), { recursive: true });

            const logoSize = Math.round(size * logoFraction);

            const fgBuffer = await sharp({
                create: {
                    width: size,
                    height: size,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
            .composite([{
                input: await sharp(trimmedBuffer)
                    .resize({ width: logoSize, height: logoSize, fit: 'inside' })
                    .toBuffer(),
                gravity: 'center'
            }])
            .png()
            .toBuffer();

            fs.writeFileSync(outPath, fgBuffer);
        }

        for (const [folder, size] of Object.entries(legacySizes)) {
            const outPathNormal = path.join(resDir, folder, 'ic_launcher.png');
            const outPathRound = path.join(resDir, folder, 'ic_launcher_round.png');

            const legacyBuffer = await sharp({
                create: {
                    width: size,
                    height: size,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                }
            })
            .composite([{
                input: await sharp(trimmedBuffer)
                    .resize({ width: size, height: size, fit: 'inside' })
                    .toBuffer(),
                gravity: 'center'
            }])
            .png()
            .toBuffer();

            if (fs.existsSync(outPathNormal)) fs.writeFileSync(outPathNormal, legacyBuffer);
            if (fs.existsSync(outPathRound)) fs.writeFileSync(outPathRound, legacyBuffer);
        }
        console.log('Successfully maximized icons for', appDir);
    } catch (e) {
        console.error('Error on', appDir, e);
    }
}

async function run() {
    for (const app of apps) {
        await processApp(app);
    }
}

run();

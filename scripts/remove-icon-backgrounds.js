const sharp = require('../garcom-app-nativo/node_modules/sharp');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Android Sizes
const legacySizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
    'mipmap-ldpi': 36
};

const foregroundSizes = {
    'mipmap-mdpi': 108,
    'mipmap-hdpi': 162,
    'mipmap-xhdpi': 216,
    'mipmap-xxhdpi': 324,
    'mipmap-xxxhdpi': 432,
    'mipmap-ldpi': 81
};

// 88.8% coverage inside 108dp base for foreground, matching garcom-app-nativo
const fgCoverage = 96 / 108;

// Flood fill and unmultiply white background
async function removeWhiteBackground(filePath) {
    console.log(`[FloodFill] Processing white background removal for: ${filePath}`);
    const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, ch = info.channels;
    
    const isExt = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    
    // Near-white test: delta max < 25 (RGB all > 230)
    const isNearWhite = (idx) => {
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        return (r > 230 && g > 230 && b > 230);
    };
    
    // Seed borders
    for (let x = 0; x < w; x++) {
        if (isNearWhite(x * ch)) { isExt[x] = 1; queue[tail++] = x; }
        const bIdx = (h - 1) * w + x;
        if (isNearWhite(bIdx * ch)) { isExt[bIdx] = 1; queue[tail++] = bIdx; }
    }
    for (let y = 0; y < h; y++) {
        const lIdx = y * w;
        if (!isExt[lIdx] && isNearWhite(lIdx * ch)) { isExt[lIdx] = 1; queue[tail++] = lIdx; }
        const rIdx = y * w + w - 1;
        if (!isExt[rIdx] && isNearWhite(rIdx * ch)) { isExt[rIdx] = 1; queue[tail++] = rIdx; }
    }
    
    while (head < tail) {
        const p = queue[head++];
        const px = p % w, py = Math.floor(p / w);
        if (px > 0 && !isExt[p-1] && isNearWhite((p-1)*ch)) { isExt[p-1] = 1; queue[tail++] = p-1; }
        if (px < w-1 && !isExt[p+1] && isNearWhite((p+1)*ch)) { isExt[p+1] = 1; queue[tail++] = p+1; }
        if (py > 0 && !isExt[p-w] && isNearWhite((p-w)*ch)) { isExt[p-w] = 1; queue[tail++] = p-w; }
        if (py < h-1 && !isExt[p+w] && isNearWhite((p+w)*ch)) { isExt[p+w] = 1; queue[tail++] = p+w; }
    }
    
    // Fringe detection (non-exterior pixels 8-adjacent to exterior)
    const isFringe = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            if (!isExt[p]) {
                let adj = false;
                for (let dy = -1; dy <= 1 && !adj; dy++) {
                    for (let dx = -1; dx <= 1 && !adj; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            if (isExt[ny * w + nx]) adj = true;
                        }
                    }
                }
                if (adj) isFringe[p] = 1;
            }
        }
    }
    
    // Unmultiply colors from white background for clean, fringe-free alpha
    const out = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const src = i * ch;
        const dst = i * 4;
        const r = data[src], g = data[src+1], b = data[src+2];
        
        if (isExt[i]) {
            out[dst] = 0; out[dst+1] = 0; out[dst+2] = 0; out[dst+3] = 0;
        } else if (isFringe[i]) {
            const maxDelta = Math.max(255 - r, 255 - g, 255 - b);
            if (maxDelta < 10) {
                out[dst] = 0; out[dst+1] = 0; out[dst+2] = 0; out[dst+3] = 0;
            } else {
                const alpha = Math.min(1.0, maxDelta / 80.0);
                const unmult = (c) => Math.max(0, Math.min(255, Math.round((c - 255 * (1 - alpha)) / alpha)));
                out[dst] = unmult(r);
                out[dst+1] = unmult(g);
                out[dst+2] = unmult(b);
                out[dst+3] = Math.round(alpha * 255);
            }
        } else {
            out[dst] = r;
            out[dst+1] = g;
            out[dst+2] = b;
            out[dst+3] = (ch > 3) ? data[src+3] : 255;
        }
    }
    
    return await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// Generate all Android mipmap PNGs and XML configs for an app
async function generateAndroidIcons(appDir, trimmedBuffer) {
    const resDir = path.join(appDir, 'android', 'app', 'src', 'main', 'res');
    if (!fs.existsSync(resDir)) {
        console.log(`[Android] Skipped (no res directory): ${resDir}`);
        return;
    }
    console.log(`[Android] Updating Android icon resources in ${resDir}`);
    
    // 1. Legacy & Round Icons (ic_launcher.png, ic_launcher_round.png)
    for (const [folder, size] of Object.entries(legacySizes)) {
        const folderPath = path.join(resDir, folder);
        if (!fs.existsSync(folderPath)) continue;
        
        const innerSize = Math.round(size * 0.92);
        const iconBuf = await sharp({
            create: {
                width: size,
                height: size,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{
            input: await sharp(trimmedBuffer)
                .resize({ width: innerSize, height: innerSize, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toBuffer(),
            gravity: 'center'
        }])
        .png()
        .toBuffer();
        
        fs.writeFileSync(path.join(folderPath, 'ic_launcher.png'), iconBuf);
        fs.writeFileSync(path.join(folderPath, 'ic_launcher_round.png'), iconBuf);
    }
    
    // 2. Adaptive Foreground Icons (ic_launcher_foreground.png)
    for (const [folder, size] of Object.entries(foregroundSizes)) {
        const folderPath = path.join(resDir, folder);
        if (!fs.existsSync(folderPath)) continue;
        
        const innerSize = Math.round(size * fgCoverage);
        const fgBuf = await sharp({
            create: {
                width: size,
                height: size,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{
            input: await sharp(trimmedBuffer)
                .resize({ width: innerSize, height: innerSize, fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .toBuffer(),
            gravity: 'center'
        }])
        .png()
        .toBuffer();
        
        fs.writeFileSync(path.join(folderPath, 'ic_launcher_foreground.png'), fgBuf);
    }
    
    // 3. Adaptive Background Icons (ic_launcher_background.png) - 100% transparent
    for (const [folder, size] of Object.entries(foregroundSizes)) {
        const folderPath = path.join(resDir, folder);
        if (!fs.existsSync(folderPath)) continue;
        
        const bgPath = path.join(folderPath, 'ic_launcher_background.png');
        const bgBuf = await sharp({
            create: {
                width: size,
                height: size,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .png()
        .toBuffer();
        
        fs.writeFileSync(bgPath, bgBuf);
    }
    
    // 4. Update XML colors and drawables to transparent
    const valuesDir = path.join(resDir, 'values');
    if (fs.existsSync(valuesDir)) {
        const icLauncherBgXml = path.join(valuesDir, 'ic_launcher_background.xml');
        fs.writeFileSync(icLauncherBgXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#00000000</color>\n</resources>\n`);
        
        const colorsXml = path.join(valuesDir, 'colors.xml');
        if (fs.existsSync(colorsXml)) {
            let colorsContent = fs.readFileSync(colorsXml, 'utf8');
            if (colorsContent.includes('ic_launcher_background')) {
                colorsContent = colorsContent.replace(/<color name="ic_launcher_background">.*?<\/color>/, '<color name="ic_launcher_background">#00000000</color>');
            } else {
                colorsContent = colorsContent.replace('</resources>', '    <color name="ic_launcher_background">#00000000</color>\n</resources>');
            }
            fs.writeFileSync(colorsXml, colorsContent);
        } else {
            fs.writeFileSync(colorsXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#00000000</color>\n</resources>\n`);
        }
    }
    
    // 5. Update drawable/ic_launcher_background.xml
    const drawableDir = path.join(resDir, 'drawable');
    if (fs.existsSync(drawableDir)) {
        const bgDrawable = path.join(drawableDir, 'ic_launcher_background.xml');
        if (fs.existsSync(bgDrawable)) {
            fs.writeFileSync(bgDrawable, `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n    <path\n        android:fillColor="#00000000"\n        android:pathData="M0,0h108v108h-108z" />\n</vector>\n`);
        }
    }
}

// Safely write a resized file if target dir exists
async function writeResized(buffer, outPath, width, height, format = 'png') {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    let pipeline = sharp(buffer).resize({
        width,
        height,
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
    });
    
    if (format === 'webp') {
        await pipeline.webp({ alphaQuality: 100, lossless: true }).toFile(outPath);
    } else {
        await pipeline.png().toFile(outPath);
    }
    console.log(`  [Written] ${outPath} (${width}x${height} ${format})`);
}

async function main() {
    console.log('=== Starting Icon Background Removal for Cozinha, Churrasqueiro, and Motoboy ===');
    
    // -------------------------------------------------------------
    // 1. COZINHA
    // -------------------------------------------------------------
    console.log('\n--- 1. Processing Cozinha ---');
    const cozinhaSrc = path.join(ROOT_DIR, 'cozinha-app-nativo', 'assets', 'icon.png');
    const cozinhaTransparent = await removeWhiteBackground(cozinhaSrc);
    const cozinhaTrimmed = await sharp(cozinhaTransparent).trim().toBuffer();
    
    // Master 1024x1024
    const cozinhaMaster = await sharp(cozinhaTrimmed)
        .resize({ width: 960, height: 960, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: 32, bottom: 32, left: 32, right: 32, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
        
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'cozinha-app-nativo', 'icon.png'), 1024, 1024);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'cozinha-app-nativo', 'assets', 'icon.png'), 1024, 1024);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'frontend', 'cozinha', 'icon.png'), 1024, 1024);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'frontend', 'cozinha', 'icon-512.png'), 512, 512);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'frontend', 'cozinha', 'icon-192.png'), 192, 192);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'frontend', 'cozinha', 'icon-192.webp'), 192, 192, 'webp');
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'frontend', 'cozinha', 'icons', 'icon-192.webp'), 192, 192, 'webp');
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'cozinha-app-nativo', 'www', 'icon.png'), 1024, 1024);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'cozinha-app-nativo', 'www', 'icon-192.png'), 192, 192);
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'cozinha-app-nativo', 'www', 'icon-192.webp'), 192, 192, 'webp');
    await writeResized(cozinhaMaster, path.join(ROOT_DIR, 'cozinha-app-nativo', 'www', 'icons', 'icon-192.webp'), 192, 192, 'webp');
    
    // Android assets public
    const cozinhaPublic = path.join(ROOT_DIR, 'cozinha-app-nativo', 'android', 'app', 'src', 'main', 'assets', 'public');
    if (fs.existsSync(cozinhaPublic)) {
        await writeResized(cozinhaMaster, path.join(cozinhaPublic, 'icon.png'), 1024, 1024);
        await writeResized(cozinhaMaster, path.join(cozinhaPublic, 'icon-192.png'), 192, 192);
        await writeResized(cozinhaMaster, path.join(cozinhaPublic, 'icon-192.webp'), 192, 192, 'webp');
        await writeResized(cozinhaMaster, path.join(cozinhaPublic, 'icons', 'icon-192.webp'), 192, 192, 'webp');
    }
    
    await generateAndroidIcons(path.join(ROOT_DIR, 'cozinha-app-nativo'), cozinhaTrimmed);

    // -------------------------------------------------------------
    // 2. CHURRASQUEIRO
    // -------------------------------------------------------------
    console.log('\n--- 2. Processing Churrasqueiro ---');
    const churrasSrc = path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'icon.png');
    const churrasTransparent = await removeWhiteBackground(churrasSrc);
    const churrasTrimmed = await sharp(churrasTransparent).trim().toBuffer();
    
    // Master 1024x1024
    const churrasMaster = await sharp(churrasTrimmed)
        .resize({ width: 960, height: 960, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: 32, bottom: 32, left: 32, right: 32, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
        
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'icon.png'), 1024, 1024);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'assets', 'icon.png'), 1024, 1024);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'frontend', 'churrasqueiro', 'icon.png'), 1024, 1024);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'frontend', 'churrasqueiro', 'icon-512.png'), 512, 512);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'frontend', 'churrasqueiro', 'icon-192.png'), 192, 192);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'frontend', 'churrasqueiro', 'icon-192.webp'), 192, 192, 'webp');
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'frontend', 'churrasqueiro', 'icons', 'icon-192.webp'), 192, 192, 'webp');
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'www', 'icon.png'), 1024, 1024);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'www', 'icon-192.png'), 192, 192);
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'www', 'icon-192.webp'), 192, 192, 'webp');
    await writeResized(churrasMaster, path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'www', 'icons', 'icon-192.webp'), 192, 192, 'webp');
    
    // Android assets public
    const churrasPublic = path.join(ROOT_DIR, 'churrasqueiro-app-nativo', 'android', 'app', 'src', 'main', 'assets', 'public');
    if (fs.existsSync(churrasPublic)) {
        await writeResized(churrasMaster, path.join(churrasPublic, 'icon.png'), 1024, 1024);
        await writeResized(churrasMaster, path.join(churrasPublic, 'icon-192.png'), 192, 192);
        await writeResized(churrasMaster, path.join(churrasPublic, 'icon-192.webp'), 192, 192, 'webp');
        await writeResized(churrasMaster, path.join(churrasPublic, 'icons', 'icon-192.webp'), 192, 192, 'webp');
    }
    
    await generateAndroidIcons(path.join(ROOT_DIR, 'churrasqueiro-app-nativo'), churrasTrimmed);

    // -------------------------------------------------------------
    // 3. MOTOBOY
    // -------------------------------------------------------------
    console.log('\n--- 3. Processing Motoboy ---');
    // Source: already transparent in frontend/motoboy/icon-512.png
    const motoboySrc = path.join(ROOT_DIR, 'frontend', 'motoboy', 'icon-512.png');
    const motoboyTrimmed = await sharp(motoboySrc).trim().toBuffer();
    
    // Master 1024x1024
    const motoboyMaster = await sharp(motoboyTrimmed)
        .resize({ width: 960, height: 960, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: 32, bottom: 32, left: 32, right: 32, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
        
    await writeResized(motoboyMaster, path.join(ROOT_DIR, 'motoboy-app-nativo', 'icon.png'), 1024, 1024);
    await writeResized(motoboyMaster, path.join(ROOT_DIR, 'motoboy-app-nativo', 'assets', 'icon.png'), 1024, 1024);
    await writeResized(motoboyMaster, path.join(ROOT_DIR, 'frontend', 'motoboy', 'icon.png'), 1024, 1024);
    await writeResized(motoboyMaster, path.join(ROOT_DIR, 'frontend', 'motoboy', 'icon-512.png'), 512, 512);
    await writeResized(motoboyMaster, path.join(ROOT_DIR, 'frontend', 'motoboy', 'icon-192.png'), 192, 192);
    
    // Motoboy webp icons in motoboy-app-nativo/icons/
    const webpSizes = [48, 72, 96, 128, 192, 256, 512];
    for (const s of webpSizes) {
        await writeResized(motoboyMaster, path.join(ROOT_DIR, 'motoboy-app-nativo', 'icons', `icon-${s}.webp`), s, s, 'webp');
    }
    
    await generateAndroidIcons(path.join(ROOT_DIR, 'motoboy-app-nativo'), motoboyTrimmed);

    console.log('\n=== All icons processed successfully! ===');
}

main().catch(err => {
    console.error('Fatal error during icon processing:', err);
    process.exit(1);
});

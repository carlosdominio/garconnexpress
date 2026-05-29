const fs = require('fs');
const content = fs.readFileSync('C:/Users/Admin/meu-zap-bot/public/index.html', 'utf8');

console.log('--- SEARCHING FOR OVERLAY ---');
const overlayIndex = content.indexOf('image-viewer-overlay');
if (overlayIndex !== -1) {
    console.log('Found overlay at index:', overlayIndex);
    console.log(content.substring(overlayIndex - 50, overlayIndex + 500));
} else {
    console.log('Overlay NOT FOUND');
}

console.log('\n--- SEARCHING FOR DELETE BUTTON ---');
const deleteBtnIndex = content.indexOf('image-viewer-delete');
if (deleteBtnIndex !== -1) {
    console.log('Found delete button at index:', deleteBtnIndex);
    console.log(content.substring(deleteBtnIndex - 50, deleteBtnIndex + 500));
} else {
    console.log('Delete button NOT FOUND');
}

console.log('\n--- SEARCHING FOR abrirImagem FUNCTION ---');
const abrirImgIndex = content.indexOf('function abrirImagem');
if (abrirImgIndex !== -1) {
    console.log('Found abrirImagem at index:', abrirImgIndex);
    console.log(content.substring(abrirImgIndex, abrirImgIndex + 600));
} else {
    console.log('abrirImagem NOT FOUND');
}

console.log('\n--- SEARCHING FOR CSS ---');
const cssIndex = content.indexOf('#image-viewer-delete');
if (cssIndex !== -1) {
    console.log('Found CSS at index:', cssIndex);
    console.log(content.substring(cssIndex, cssIndex + 300));
}

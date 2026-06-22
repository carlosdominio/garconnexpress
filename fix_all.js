const fs = require('fs');
const path = require('path');

function replaceFile(filePath, replacements) {
    const fullPath = path.resolve(filePath);
    let content = fs.readFileSync(fullPath, 'utf8');
    for (const r of replacements) {
        if (!content.includes(r.old)) {
            console.log('WARNING: Could not find string in ' + filePath);
            console.log(r.old.substring(0, 50) + '...');
        }
        content = content.replace(r.old, r.new);
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log('Fixed ' + filePath);
}

// 1. SW.js
replaceFile('frontend/cardapio/sw.js', [{
    old: self.addEventListener('fetch', event => {\n  if (event.request.mode === 'navigate' || event.request.url.includes('index.html')) {\n    event.respondWith(\n      fetch(event.request).catch(() => caches.match(event.request))\n    );\n    return;\n  }\n  \n  event.respondWith(\n    caches.match(event.request).then(response => {\n      if (response) return response;\n      return fetch(event.request).catch(() => {});\n    })\n  );\n});,
    new: self.addEventListener('fetch', event => {\n  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('pusher')) return;\n  if (event.request.mode === 'navigate' || event.request.url.includes('index.html')) {\n    event.respondWith(\n      fetch(event.request).catch(() => caches.match(event.request).then(r => r || new Response("Offline", {status:503})))\n    );\n    return;\n  }\n  event.respondWith(\n    caches.match(event.request).then(response => {\n      if (response) return response;\n      return fetch(event.request).catch(() => new Response("Offline", {status:503}));\n    })\n  );\n});
}]);

// 2. server.js
replaceFile('server.js', [
    {
        old: pp.delete('/api/garcons/:id', async (req, res) => { \n  try {\n    await query('DELETE FROM garcons WHERE id = ?', [req.params.id]);,
        new: pp.delete('/api/garcons/:id', async (req, res) => { \n  try {\n    const garcom = await query('SELECT usuario FROM garcons WHERE id = ?', [req.params.id]);\n    if (garcom.rows && garcom.rows.length > 0) await query("UPDATE mesas SET status = 'livre', garcom_id = NULL WHERE garcom_id = ?", [garcom.rows[0].usuario]);\n    await query('DELETE FROM garcons WHERE id = ?', [req.params.id]);
    },
    {
        old: pp.get('/api/cron/cardapio', async (req, res) => {\n    try {,
        new: pp.get('/api/cron/cardapio', async (req, res) => {\n    try {\n        await query("UPDATE mesas SET status = 'livre', garcom_id = NULL WHERE garcom_id IS NOT NULL AND garcom_id NOT IN (SELECT usuario FROM garcons WHERE usuario IS NOT NULL)");\n        await query("UPDATE pedidos SET status = 'cancelado' WHERE status NOT IN ('entregue', 'cancelado') AND garcom_id IS NOT NULL AND garcom_id != 'ADMIN' AND garcom_id != 'QRCODE' AND garcom_id NOT IN (SELECT usuario FROM garcons WHERE usuario IS NOT NULL)");
    },
    {
        old:       querySql += \ WHERE visivel = \ AND (estoque = -1 OR (estoque IS NOT NULL AND estoque > 0))\;\n    }\n    \n    const menuRes,
        new:       querySql += \ WHERE visivel = \ AND (estoque = -1 OR (estoque IS NOT NULL AND estoque > 0))\;\n    }\n    querySql += ' ORDER BY categoria ASC, nome ASC';\n    const menuRes
    }
]);

// 3. frontend/cardapio/index.html
replaceFile('frontend/cardapio/index.html', [
    {
        old: :root { --primary: #ff4757; --primary-dark: #e84118;,
        new: :root { --primary: #ea1d2c; --primary-dark: #b51722;
    },
    {
        old: .category-pill.active { background: var(--primary); color: white; transform: translateY(-2px); box-shadow: 0 6px 15px rgba(255, 71, 87, 0.3); },
        new: .category-pill.active { background: var(--primary); color: white; }
    },
    {
        old: <title>Cardápio Digital - GarconnExpress</title>,
        new: <title>Cardápio Digital - Guga Bebidas</title>
    },
    {
        old: <header><h1>GarconnExpress</h1>,
        new: <header><h1>Guga Bebidas</h1>
    }
]);

// 4. frontend/delivery/index.html
replaceFile('frontend/delivery/index.html', [
    {
        old: :root { --primary: #27ae60; --primary-dark: #1e8449;,
        new: :root { --primary: #ea1d2c; --primary-dark: #b51722;
    },
    {
        old: .category-pill.active { background: var(--primary); color: white; transform: translateY(-2px); box-shadow: 0 6px 15px rgba(39, 174, 96, 0.3); },
        new: .category-pill.active { background: var(--primary); color: white; }
    }
]);

// 5. frontend/admin/app_v3.js
replaceFile('frontend/admin/app_v3.js', [
    {
        old: <div style="display:flex; flex-direction:column; gap:0.2rem">\n                    <button style="background:#3498db; padding:4px 8px; font-size:0.8rem" onclick="prepararEdicaoMenuById(\)">✏️ Editar</button>\n                    <button class="btn-excluir" onclick="excluirDoMenu(\)">Excluir</button>\n                  </div>,
        new: <div style="display:flex; flex-direction:column; gap:0.4rem; justify-content:center; align-items:stretch; min-width:80px;">\n                    <button style="background:#3498db; padding:6px; font-size:0.8rem; border:none; border-radius:6px; color:white; cursor:pointer; height:max-content; box-shadow:0 2px 4px rgba(0,0,0,0.1);" onclick="prepararEdicaoMenuById(\)">✏️ Editar</button>\n                    <button style="background:#e74c3c; padding:6px; font-size:0.8rem; border:none; border-radius:6px; color:white; cursor:pointer; height:max-content; box-shadow:0 2px 4px rgba(0,0,0,0.1);" onclick="excluirDoMenu(\)">Excluir</button>\n                  </div>
    }
]);

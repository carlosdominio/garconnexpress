const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf8');
    for (const rep of replacements) {
        if (typeof rep.from === 'string') {
            content = content.replace(rep.from, rep.to);
        } else {
            content = content.replace(rep.from, rep.to);
        }
    }
    fs.writeFileSync(filePath, content, 'utf8');
}

// 1. server.js
replaceInFile(path.join(__dirname, 'server.js'), [
    {
        from: /if \(mesa_id\) \{\s*const mesaObj = \(await query\("SELECT status FROM mesas WHERE id = \?", \[mesa_id\]\)\)\.rows\[0\];\s*if \(mesaObj && \(mesaObj\.status === 'fechando' \|\| mesaObj\.status === 'aguardando_fechamento'\)\) \{\s*return res\.status\(403\)\.json\(\{ error: 'CONTA_SOLICITADA' \}\);\s*\}/,
        to: if (mesa_id) {\n      const mesaObj = (await query("SELECT status, garcom_id FROM mesas WHERE id = ?", [mesa_id])).rows[0];\n      if (mesaObj && (mesaObj.status === 'fechando' || mesaObj.status === 'aguardando_fechamento')) {\n        return res.status(403).json({ error: 'CONTA_SOLICITADA' });\n      }\n      \n      // TRAVA DE FILA (RODÍZIO) - BACKEND LOCKOUT\n      if (mesaObj && mesaObj.status === 'ocupada' && mesaObj.garcom_id && !isDelivery) {\n        // Se a mesa tem um garçom atribuído e não é o garçom atual, bloqueia.\n        const isAdmin = req.user && req.user.role === 'admin';\n        const isClient = req.user && req.user.role === 'cliente';\n        if (!isAdmin && !isClient && mesaObj.garcom_id !== garcom_id) {\n            console.log(\🔒 [BLOQUEIO DE ACESSO] Garçom \ tentou acessar a mesa \ que está bloqueada para o garçom \\);\n            return res.status(403).json({\n                error: 'MESA_ATENDIDA_POR_OUTRO',\n                message: \MESA BLOQUEADA! O garçom selecionado na fila (\) deve atender esta mesa.\\n            });\n        }\n      }
    },
    {
        from: /try \{\s*const pOrig = \(await query\("SELECT cobrar_taxa FROM pedidos WHERE id = \?", \[id\]\)\)\.rows\[0\];\s*const deveTaxa = cobrar_taxa !== undefined \? cobrar_taxa : \(pOrig \? pOrig\.cobrar_taxa : true\);/,
        to: 	ry {\n    const pOrig = (await query("SELECT mesa_id, garcom_id, cobrar_taxa FROM pedidos WHERE id = ?", [id])).rows[0];\n    const deveTaxa = cobrar_taxa !== undefined ? cobrar_taxa : (pOrig ? pOrig.cobrar_taxa : true);\n    \n    // TRAVA DE FILA (RODÍZIO) - BACKEND LOCKOUT\n    if (pOrig && pOrig.garcom_id && pOrig.garcom_id !== 'DELIVERY') {\n        const isAdmin = req.user && req.user.role === 'admin';\n        const isClient = req.user && req.user.role === 'cliente';\n        const garcom_id = req.user ? (req.user.usuario || req.user.nome) : null;\n        if (!isAdmin && !isClient && pOrig.garcom_id !== garcom_id) {\n            console.log(\🔒 [BLOQUEIO DE ACESSO] Garçom \ tentou adicionar itens ao pedido \ bloqueado para o garçom \\);\n            return res.status(403).json({\n                error: 'MESA_ATENDIDA_POR_OUTRO',\n                message: \MESA BLOQUEADA! O garçom selecionado na fila (\) deve atender esta mesa.\\n            });\n        }\n    }
    }
]);

// 2. Apps do Garçom
const garcomFiles = [
    path.join(__dirname, 'frontend/garcom/app.js'),
    path.join(__dirname, 'garcom-app-nativo/www/app.js')
];

for (const f of garcomFiles) {
    replaceInFile(f, [
        {
            from: /\} else if \(!mesa\.pedido_created_at && !mesa\.pedido_status && mesa\.status === 'ocupada'\) \{\s*statusTexto = '⏳ AGUARDANDO CLIENTE';\s*classeAlerta = 'cliente-acessando';/,
            to: } else if (!mesa.pedido_created_at && !mesa.pedido_status && mesa.status === 'ocupada') {\n        if (!eMeuPedido && mesa.garcom_id) {\n          classeBloqueada = 'bloqueada';\n          statusTexto = \🔒 AGUARDANDO CLIENTE (\)\;\n        } else {\n          statusTexto = '📱 AGUARDANDO CLIENTE';\n          classeAlerta = 'cliente-acessando';\n        }
        },
        {
            from: /statusTexto = \OCUPADA \(\$\{mesa\.garcom_id\}\)\;/,
            to: "statusTexto = \🔒 OCUPADA (\)\;"
        },
        {
            from: /await mostrarAlerta\(\Atendida por: \$\{mesaSelecionada\.garcom_id\}\, "Mesa Ocupada", "⚠️"\);/,
            to: "await mostrarAlerta(\🔒 MESA BLOQUEADA\\nO garçom selecionado na fila (\) deve atender esta mesa.\, \"Acesso Negado\", \"🚫\");"
        }
    ]);
}

// 3. Admin Toast sound
replaceInFile(path.join(__dirname, 'frontend/admin/app_v3.js'), [
    {
        from: /await mostrarConfirmacaoFCM\('Sucesso', '.*? test.*?!', 'sucesso', true\);/,
        to: "await mostrarConfirmacaoFCM('Sucesso', '🚀 Alerta de teste disparado via websocket para todos os apps ativos!', 'sucesso', true);\n      if (typeof tocarNotificacao === 'function') tocarNotificacao('campainha');"
    }
]);

// 4. Test Toast Fixes (all apps)
const clientFiles = [
    ...garcomFiles,
    path.join(__dirname, 'frontend/cozinha/app.js'),
    path.join(__dirname, 'cozinha-app-nativo/www/app.js'),
    path.join(__dirname, 'frontend/motoboy/app.js'),
    path.join(__dirname, 'motoboy-app-nativo/www/app.js')
];

for (const f of clientFiles) {
    if (fs.existsSync(f)) {
        replaceInFile(f, [
            {
                from: /if \(deveTocarSom\('teste-toast'\)\) tocarCampainha\(true\);/g,
                to: "if (deveTocarSom(data.evento || 'teste-toast')) tocarCampainha(false);"
            }
        ]);
    }
}

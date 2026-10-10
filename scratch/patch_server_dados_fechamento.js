const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const targetStr = `        // Notifica o cliente logado para encerrar o acesso
        const msgLogout = status === 'entregue' ? "Sua conta foi finalizada. Obrigado pela preferência!" : "Este pedido foi cancelado pelo estabelecimento. Seu acesso foi encerrado.";
        await safePusherTrigger('garconnexpress', \`deslogar-mesa-\${pm.mesa_id}\`, { 
          mensagem: msgLogout,
          status: status, // envia 'cancelado' ou 'entregue'
          mesa_id: pm.mesa_id 
        });`;

const replacementStr = `        // Notifica o cliente logado para encerrar o acesso
        const finalPedido = (await query("SELECT * FROM pedidos WHERE id = ?", [id])).rows[0];
        const finalItens = (await query("SELECT i.quantidade, COALESCE(i.preco, m.preco) as preco, COALESCE(m.nome, 'Item Customizado') as nome FROM pedido_itens i LEFT JOIN menu m ON i.menu_id = m.id WHERE i.pedido_id = ?", [id])).rows;
        
        const msgLogout = status === 'entregue' ? "Sua conta foi finalizada. Obrigado pela preferência!" : "Este pedido foi cancelado pelo estabelecimento. Seu acesso foi encerrado.";
        await safePusherTrigger('garconnexpress', \`deslogar-mesa-\${pm.mesa_id}\`, { 
          mensagem: msgLogout,
          status: status, // envia 'cancelado' ou 'entregue'
          mesa_id: pm.mesa_id,
          dados_fechamento: { pedido: finalPedido, itens: finalItens }
        });`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replacementStr);
    fs.writeFileSync('server.js', content);
    console.log('Successfully patched server.js!');
} else {
    console.log('Failed to find target string in server.js');
}

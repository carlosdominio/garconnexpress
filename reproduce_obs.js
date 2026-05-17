
const axios = require('axios');

async function test() {
    try {
        const baseUrl = 'http://localhost:3001';
        
        // 1. Get menu to find an item
        const menuRes = await axios.get(`${baseUrl}/api/menu`);
        const item = menuRes.data.find(i => i.id === 4) || menuRes.data[0];
        if (!item) {
            console.log('❌ No menu items found');
            return;
        }

        console.log(`Using item: ${item.nome} (ID: ${item.id})`);

        // 2. Create order with observation
        const orderData = {
            mesa_id: 1,
            garcom_id: 'TestBot',
            itens: [
                {
                    menu_id: item.id,
                    nome: item.nome,
                    preco: item.preco,
                    quantidade: 1,
                    observacao: 'TESTE OBSERVAÇÃO'
                }
            ]
        };

        console.log('Sending order...');
        const orderRes = await axios.post(`${baseUrl}/api/pedidos`, orderData);
        const orderId = orderRes.data.id;
        console.log(`✅ Order created with ID: ${orderId}`);

        // 3. Check kitchen API
        console.log('Checking kitchen API...');
        const kitchenRes = await axios.get(`${baseUrl}/api/pedidos/cozinha`);
        const kitchenItems = kitchenRes.data;
        
        const myItem = kitchenItems.find(i => i.pedido_id === orderId);
        if (myItem) {
            console.log(`Found item in kitchen. Observation: "${myItem.observacao}"`);
            if (myItem.observacao === 'TESTE OBSERVAÇÃO') {
                console.log('✅ Success: Observation correctly received in kitchen API!');
            } else {
                console.log('❌ Failure: Observation mismatch or missing!');
            }
        } else {
            console.log('❌ Failure: Item not found in kitchen (maybe category filter?)');
        }

    } catch (error) {
        console.error('❌ Error during test:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

test();

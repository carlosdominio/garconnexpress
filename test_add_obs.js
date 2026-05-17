
const axios = require('axios');

async function test() {
    try {
        const baseUrl = 'http://localhost:3001';
        
        // 1. Create a base order
        const baseOrder = {
            mesa_id: 2,
            garcom_id: 'TestBot',
            itens: [{ menu_id: 1, nome: 'Skol', preco: 10, quantidade: 1, observacao: '' }]
        };
        const orderRes = await axios.post(`${baseUrl}/api/pedidos`, baseOrder);
        const orderId = orderRes.data.id;
        console.log(`✅ Base order created with ID: ${orderId}`);

        // 2. Add kitchen item with observation
        const addData = {
            itens: [
                {
                    menu_id: 4,
                    nome: 'Batata',
                    preco: 25,
                    quantidade: 1,
                    observacao: 'BEM SEQUINHA'
                }
            ]
        };

        console.log('Adding item to order...');
        await axios.put(`${baseUrl}/api/pedidos/${orderId}/adicionar`, addData);
        console.log('✅ Item added');

        // 3. Check kitchen API
        console.log('Checking kitchen API...');
        const kitchenRes = await axios.get(`${baseUrl}/api/pedidos/cozinha`);
        const kitchenItems = kitchenRes.data;
        
        const myItem = kitchenItems.find(i => i.pedido_id === orderId && i.item_nome === 'Petisco Batata Frita');
        if (myItem) {
            console.log(`Found item in kitchen. Observation: "${myItem.observacao}"`);
            if (myItem.observacao === 'BEM SEQUINHA') {
                console.log('✅ Success: Observation correctly received in kitchen API after adding to order!');
            } else {
                console.log('❌ Failure: Observation mismatch or missing!');
            }
        } else {
            console.log('❌ Failure: Item not found in kitchen');
        }

    } catch (error) {
        console.error('❌ Error during test:', error.message);
    }
}

test();

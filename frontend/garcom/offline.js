// offline.js - Sistema Offline-First para salvar pedidos em IndexedDB

const DB_NAME = 'GarcomOfflineDB';
const STORE_NAME = 'pedidos_rascunho';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function salvarPedidoOffline(url, options) {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    const pedido = {
        url,
        options: {
            method: options.method,
            headers: options.headers,
            body: options.body
        },
        timestamp: Date.now()
    };
    
    return new Promise((resolve) => {
        store.add(pedido);
        tx.oncomplete = () => {
            if (typeof mostrarToast === 'function') {
                mostrarToast('Sem internet! Pedido salvo no rascunho offline.', 'warning');
            }
            // Retorna um Fake Response de sucesso para a UI não travar
            const fakeResponse = new Response(JSON.stringify({ id: 'OFFLINE-' + Date.now(), success: true, offline: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
            resolve(fakeResponse);
        };
    });
}

async function sincronizarPedidosOffline() {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    const request = store.getAll();
    request.onsuccess = async () => {
        const pedidos = request.result;
        if (pedidos.length === 0) return;
        
        if (typeof mostrarToast === 'function') {
            mostrarToast(`Sincronizando ${pedidos.length} pedido(s) offline...`, 'info');
        }

        for (const p of pedidos) {
            try {
                // Remove Authorization header from offline copy to force fresh token injection by global fetch if needed, 
                // OR we just use originalFetch with the stored headers.
                // It's safer to use the global window.fetch so it gets the latest token
                const res = await window.fetch(p.url, p.options);
                if (res.ok) {
                    const deleteTx = db.transaction(STORE_NAME, 'readwrite');
                    deleteTx.objectStore(STORE_NAME).delete(p.id);
                }
            } catch (e) {
                console.error("Falha ao sincronizar pedido offline", e);
            }
        }
        
        if (typeof mostrarToast === 'function') {
            mostrarToast('Pedidos sincronizados com sucesso!', 'success');
        }
    };
}

window.addEventListener('online', sincronizarPedidosOffline);

// Expõe para o app.js interceptar
window.salvarPedidoOffline = salvarPedidoOffline;

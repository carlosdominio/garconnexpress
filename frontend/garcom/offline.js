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
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        const pedido = {
            url,
            options: {
                method: options.method || 'POST',
                headers: options.headers || {},
                body: options.body || null
            },
            tentativas: 0,
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
            tx.onerror = () => {
                const fakeResponse = new Response(JSON.stringify({ id: 'OFFLINE-' + Date.now(), success: true, offline: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
                resolve(fakeResponse);
            };
        });
    } catch (err) {
        console.error('Falha ao salvar offline no IndexedDB:', err);
        return new Response(JSON.stringify({ id: 'OFFLINE-' + Date.now(), success: true, offline: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

let isSyncingOffline = false;
async function sincronizarPedidosOffline() {
    if (isSyncingOffline) return;
    isSyncingOffline = true;

    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        
        const pedidos = await new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        if (!pedidos || pedidos.length === 0) return;
        
        if (typeof mostrarToast === 'function') {
            mostrarToast(`Sincronizando ${pedidos.length} pedido(s) offline...`, 'info');
        }

        let sucessoCount = 0;
        for (const p of pedidos) {
            try {
                // Atualiza o token caso tenha expirado ou renovado
                const tokenAtual = localStorage.getItem('garcom_token');
                if (tokenAtual && p.options && p.options.headers) {
                    p.options.headers['Authorization'] = `Bearer ${tokenAtual}`;
                }

                const res = await window.fetch(p.url, p.options);
                if (res.ok) {
                    sucessoCount++;
                    const deleteTx = db.transaction(STORE_NAME, 'readwrite');
                    deleteTx.objectStore(STORE_NAME).delete(p.id);
                } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
                    // Erro irrecuperável do cliente (ex: mesa fechada, dados inválidos) - descarta para evitar loop eterno
                    console.warn(`[Sync Offline] Descartando requisição inválida (${res.status}):`, p);
                    const deleteTx = db.transaction(STORE_NAME, 'readwrite');
                    deleteTx.objectStore(STORE_NAME).delete(p.id);
                } else {
                    // Incrementa tentativas
                    p.tentativas = (p.tentativas || 0) + 1;
                    if (p.tentativas >= 5) {
                        console.error('[Sync Offline] Limite de tentativas excedido para pedido offline. Descartando:', p);
                        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
                        deleteTx.objectStore(STORE_NAME).delete(p.id);
                    }
                }
            } catch (e) {
                console.error("Falha ao sincronizar pedido offline", e);
            }
        }
        
        if (sucessoCount > 0 && typeof mostrarToast === 'function') {
            mostrarToast(`${sucessoCount} pedido(s) sincronizado(s) com sucesso!`, 'success');
        }
    } catch (err) {
        console.error('Erro geral ao sincronizar pedidos offline:', err);
    } finally {
        isSyncingOffline = false;
    }
}

window.addEventListener('online', sincronizarPedidosOffline);

// Expõe para o app.js interceptar
window.salvarPedidoOffline = salvarPedidoOffline;
window.sincronizarPedidosOffline = sincronizarPedidosOffline;

const fs = require('fs');
const css = `
/* === TOASTS PREMIUM V2 === */
.toast-notificacao {
    background: rgba(255, 255, 255, 0.85) !important;
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
    border-radius: 20px !important;
    box-shadow: 0 15px 35px rgba(0,0,0,0.1), 0 5px 15px rgba(0,0,0,0.05) !important;
    border-left: none !important;
    border: 1px solid rgba(255,255,255,0.4) !important;
    padding: 16px !important;
    gap: 15px !important;
    transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
}

.toast-notificacao::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 6px;
    border-radius: 20px 0 0 20px;
}

.toast-notificacao.success::before { background: linear-gradient(to bottom, #00b09b, #96c93d); }
.toast-notificacao.error::before { background: linear-gradient(to bottom, #ff0844, #ffb199); }
.toast-notificacao.warning::before { background: linear-gradient(to bottom, #f6d365, #fda085); }
.toast-notificacao.info::before { background: linear-gradient(to bottom, #4facfe, #00f2fe); }

.toast-notificacao .toast-icon {
    width: 42px !important;
    height: 42px !important;
    border-radius: 12px !important;
    font-size: 1.4rem !important;
    box-shadow: 0 4px 10px rgba(0,0,0,0.05) !important;
}

.toast-notificacao.success .toast-icon { background: linear-gradient(135deg, #e0f2f1 0%, #b2dfdb 100%) !important; color: #00897b !important; }
.toast-notificacao.error .toast-icon { background: linear-gradient(135deg, #fce4ec 0%, #f8bbd0 100%) !important; color: #d81b60 !important; }
.toast-notificacao.warning .toast-icon { background: linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%) !important; color: #f39c12 !important; }
.toast-notificacao.info .toast-icon { background: linear-gradient(135deg, #e1f5fe 0%, #b3e5fc 100%) !important; color: #039be5 !important; }

.toast-notificacao .toast-title {
    font-size: 0.95rem !important;
    color: #2c3e50 !important;
    margin-bottom: 3px !important;
}

.toast-notificacao .toast-msg {
    font-size: 0.85rem !important;
    color: #7f8c8d !important;
}

.toast-notificacao .toast-close {
    background: #f1f2f6 !important;
    border-radius: 50% !important;
    width: 26px !important;
    height: 26px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: #95a5a6 !important;
    transition: all 0.2s !important;
    top: 10px !important;
    right: 10px !important;
}

.toast-notificacao .toast-close:hover {
    background: #e74c3c !important;
    color: white !important;
    transform: rotate(90deg);
}
`;
fs.appendFileSync('style.css', css);
console.log('Toast CSS appended successfully!');

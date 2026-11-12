const fs = require('fs');
const css = `
/* === HEADER PREMIUM V2 (FIX) === */
header {
  background: rgba(30, 39, 46, 0.95) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
  color: white !important;
  padding: 0.8rem 1rem !important;
  position: sticky !important;
  top: 0 !important;
  z-index: 1100 !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
  text-align: left !important;
}
.header-content {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  width: 100% !important;
  max-width: 1000px !important;
  margin: 0 auto !important;
  gap: 10px !important;
  flex-direction: row !important;
}
.header-info {
  display: flex !important;
  align-items: center !important;
  gap: 15px !important;
  flex: 1 !important;
}
.header-controls {
  display: flex !important;
  align-items: center !important;
  gap: 15px !important;
  justify-content: flex-end !important;
  width: auto !important;
}
.brand-group h1 {
  margin: 0 !important;
  font-size: 1.3rem !important;
  font-weight: 900 !important;
  text-transform: uppercase !important;
  letter-spacing: 1px !important;
  background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: 0px 2px 4px rgba(0,0,0,0.1) !important;
}
.btn-logout {
  width: auto !important;
  background: linear-gradient(135deg, #ff0844 0%, #ffb199 100%) !important;
  color: #fff !important;
  font-size: 0.75rem !important;
  border: none !important;
  padding: 6px 14px !important;
  border-radius: 20px !important;
  font-weight: 800 !important;
  text-transform: uppercase !important;
  box-shadow: 0 4px 10px rgba(255, 8, 68, 0.3) !important;
  cursor: pointer !important;
  margin-bottom: 0 !important;
}
@media (max-width: 520px) {
  .header-content {
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 12px !important;
  }
  .header-controls {
    width: 100% !important;
    justify-content: space-between !important;
  }
  .header-info {
    width: 100% !important;
    justify-content: space-between !important;
  }
}
`;
fs.appendFileSync('style.css', css);
console.log('CSS appended successfully!');

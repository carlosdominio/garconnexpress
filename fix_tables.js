const http = require('https');
function release(id) {
  const options = {
    hostname: 'garconnexpress.vercel.app',
    path: '/api/mesas/' + id + '/liberar',
    method: 'PUT',
    headers: { 'Content-Length': '0' }
  };
  const req = http.request(options, res => {
    let d = ''; res.on('data', c => d+=c); res.on('end', () => console.log('Mesa ' + id + ' -> ' + d));
  });
  req.on('error', e => console.log(e));
  req.end();
}
release(6);
release(7);

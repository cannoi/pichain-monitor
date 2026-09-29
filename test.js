const http = require('http');

const PORT = process.env.PORT || 8080;

const server = require('./server.js');

setTimeout(() => {
  http.get(`http://localhost:${PORT}/health`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('HEALTH CHECK PASSED:', data);
        process.exit(0);
      } else {
        console.error('HEALTH CHECK FAILED:', res.statusCode);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('CONNECTION ERROR:', err.message);
    process.exit(1);
  });
}, 1500);

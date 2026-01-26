
const dns = require('dns');

const hostname = 'ep-frosty-resonance-a1n5r95g-pooler.ap-southeast-1.aws.neon.tech';
console.log(`Looking up ${hostname}...`);

dns.lookup(hostname, (err, address, family) => {
    if (err) {
        console.error('Lookup failed:', err);
    } else {
        console.log('Address:', address);
        console.log('Family: IPv' + family);
    }
});

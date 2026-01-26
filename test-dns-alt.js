
const dns = require('dns');

// Original: ep-frosty-resonance-a1n5r95g-pooler.ap-southeast-1.aws.neon.tech
// Alternative: ep-frosty-resonance-a1n5r95g.ap-southeast-1.aws.neon.tech (without -pooler)

const hostname = 'ep-frosty-resonance-a1n5r95g.ap-southeast-1.aws.neon.tech';
console.log(`Looking up ${hostname}...`);

dns.lookup(hostname, (err, address, family) => {
    if (err) {
        console.error('Lookup failed:', err);
    } else {
        console.log('Address:', address);
        console.log('Family: IPv' + family);
    }
});

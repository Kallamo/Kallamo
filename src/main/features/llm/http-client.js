// undici takes about a fifth of a second to load, so it waits for the first request instead of the launch.
let undici = null;
let dispatcher = null;
const lib = () => undici || (undici = require('undici'));

const undiciFetch = (...args) => lib().fetch(...args);

// undici's default 300s headersTimeout aborts slow local generations
// (stream:false sends headers only when generation finishes). 30 min ceiling.
function generationDispatcher() {
    return dispatcher || (dispatcher = new (lib().Agent)({
        headersTimeout: 1_800_000,
        bodyTimeout: 1_800_000
    }));
}

module.exports = { undiciFetch, generationDispatcher };

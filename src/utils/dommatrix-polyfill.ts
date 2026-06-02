import DOMMatrixPolyfill from '@thednp/dommatrix';

if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
    console.log('DOMMatrix polyfill applied to globalThis.');
}

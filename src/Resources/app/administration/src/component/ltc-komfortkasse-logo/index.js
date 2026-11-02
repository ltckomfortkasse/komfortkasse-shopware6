/**
 * Komfortkasse-Logo (das K im Kreis) als Icon in den Schaltflaechen der Bestellung. Nur Zierde, die Schaltflaechen haben einen Text.
 * mt-icon zeigt nur Meteor-Icons an, deshalb direkt als SVG.
 */
Shopware.Component.register('ltc-komfortkasse-logo', {
    template: `
<svg class="ltc-komfortkasse-logo" width="16" height="16" viewBox="0 0 2000 2000" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <path fill="#59566c" d="M 1010,55 C 488,55 65,478 65,1000 c 0,522 423,945 945,945 522,0 945,-423 945,-945 0,-522 -423,-945 -945,-945 z" />
    <path fill="#ffffff" fill-rule="evenodd" d="m 349.94452,320.94101 c -31.75892,30.91116 -61.31843,64.03429 -88.50751,99.12306 L 1228.9583,1921.707 c 43.4958,-10.3348 85.7998,-23.6688 126.7385,-39.7814 l -246.2253,-382.1561 625.7459,108.4921 c 29.559,-35.3089 56.6051,-72.7787 80.8378,-112.1898 L 1103.4863,1372.5271 1387.8088,846.35909 1275.575,785.58822 989.91974,1314.22 Z" />
</svg>
`,
});

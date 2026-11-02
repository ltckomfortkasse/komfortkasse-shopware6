import template from './sw-order-detail.html.twig';

/**
 * Schaltflaeche "In Komfortkasse oeffnen": oeffnet die Bestellung im Haendlerbereich in einem neuen Fenster (mit Anmeldung). Sichtbar bei
 * allen Bestellungen, wenn das Plugin fuer den Verkaufskanal aktiv ist.
 */
Shopware.Component.override('sw-order-detail', {
    template,

    inject: ['ltcKomfortkasseRefundLinkService'],

    data() {
        return {
            ltcKomfortkasseOrderLink: null,
        };
    },

    methods: {
        createdComponent() {
            this.$super('createdComponent');
            this.ltcKomfortkasseLoadOrderLink();
        },

        ltcKomfortkasseLoadOrderLink() {
            this.ltcKomfortkasseOrderLink = null;
            const orderId = this.orderId;
            if (!orderId) {
                return;
            }
            this.ltcKomfortkasseRefundLinkService.getOrderLink(orderId).then((result) => {
                if (orderId === this.orderId) {
                    this.ltcKomfortkasseOrderLink = result && result.url ? result.url : null;
                }
            }).catch(() => {
                this.ltcKomfortkasseOrderLink = null;
            });
        },

        onLtcKomfortkasseOpenOrder() {
            window.open(this.ltcKomfortkasseOrderLink, '_blank', 'noopener');
        },
    },
});

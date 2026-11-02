import template from './sw-order-detail.html.twig';

/**
 * Schaltflaeche "Rueckerstattung erfassen": oeffnet die Komfortkasse-Seite zur Bestellung in einem neuen Fenster. Sichtbar nur, wenn
 * Komfortkasse Rueckerstattungen fuer den Shop aktiviert hat und die Zahlung der Bestellung ueber Komfortkasse lief, und nur fuer
 * Benutzer mit dem Recht, Rueckerstattungen anzulegen.
 *
 * Schaltflaeche "In Komfortkasse oeffnen": oeffnet die Bestellung im Haendlerbereich in einem neuen Fenster (mit Anmeldung). Sichtbar bei
 * allen Bestellungen, wenn das Plugin fuer den Verkaufskanal aktiv ist.
 */
Shopware.Component.override('sw-order-detail', {
    template,

    inject: ['ltcKomfortkasseRefundLinkService'],

    data() {
        return {
            ltcKomfortkasseRefundAvailable: false,
            ltcKomfortkasseRefundLoading: false,
            ltcKomfortkasseOrderLink: null,
        };
    },

    methods: {
        createdComponent() {
            this.$super('createdComponent');
            this.ltcKomfortkasseCheckRefund();
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

        ltcKomfortkasseCheckRefund() {
            this.ltcKomfortkasseRefundAvailable = false;
            const orderId = this.orderId;
            if (!orderId || !this.acl.can('order_refund.creator')) {
                return;
            }
            this.ltcKomfortkasseRefundLinkService.isRefundLinkAvailable(orderId).then((result) => {
                if (orderId === this.orderId) {
                    this.ltcKomfortkasseRefundAvailable = !!(result && result.available);
                }
            }).catch(() => {
                this.ltcKomfortkasseRefundAvailable = false;
            });
        },

        onLtcKomfortkasseRefund() {
            // Fenster sofort im Klick oeffnen (sonst greift der Popup-Blocker), die Adresse erst nach dem Abruf setzen: jeder Klick
            // erzeugt ein neues Einmal-Token
            const target = window.open('', '_blank');
            if (target) {
                target.opener = null;
            }
            this.ltcKomfortkasseRefundLoading = true;
            this.ltcKomfortkasseRefundLinkService.createRefundLink(this.orderId).then((result) => {
                if (result && result.url && target) {
                    target.location.href = result.url;
                    return;
                }
                if (target) {
                    target.close();
                }
                this.createNotificationError({ message: this.$tc('ltc-komfortkasse.refund.error') });
            }).catch(() => {
                if (target) {
                    target.close();
                }
                this.createNotificationError({ message: this.$tc('ltc-komfortkasse.refund.error') });
            }).finally(() => {
                this.ltcKomfortkasseRefundLoading = false;
            });
        },
    },
});

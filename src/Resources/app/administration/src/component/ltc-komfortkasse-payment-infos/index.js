import template from './ltc-komfortkasse-payment-infos.html.twig';
import './ltc-komfortkasse-payment-infos.scss';

const CUSTOM_FIELD = 'komfortkasse';
// Das Buchungsdatum ist eine reine Tagesangabe (Mitternacht deutscher Zeit). In der Zeitzone des Benutzers stuende bei UTC der Vortag da.
const POSTING_DATE_TIME_ZONE = 'Europe/Berlin';

/**
 * Zahlungsdetails aus dem Zusatzfeld "komfortkasse" der Transaktion. Komfortkasse schreibt das Feld, die Karte zeigt es nur an und erscheint
 * nur, wenn es gefuellt ist. lastModified ist die letzte inhaltliche Aenderung, nicht die letzte Pruefung.
 *
 * Schaltflaeche "Rueckerstattung erfassen": oeffnet die Komfortkasse-Seite zur Bestellung in einem neuen Fenster. Sichtbar nur, wenn Komfortkasse
 * Rueckerstattungen fuer den Shop aktiviert hat und der Bestellung eine Zahlung zugeordnet ist, und nur fuer Benutzer mit dem Recht, Rueckerstattungen
 * anzulegen.
 */
Shopware.Component.register('ltc-komfortkasse-payment-infos', {
    template,

    inject: ['ltcKomfortkasseRefundLinkService', 'acl'],

    mixins: [Shopware.Mixin.getByName('notification')],

    props: {
        order: {
            type: Object,
            required: false,
            default: null,
        },
    },

    data() {
        return {
            refundAvailable: false,
            refundLoading: false,
        };
    },

    computed: {
        infos() {
            const transactions = this.order && this.order.transactions ? Array.from(this.order.transactions) : [];
            const withField = transactions.filter((t) => t.customFields && t.customFields[CUSTOM_FIELD]);
            const relevant = withField.find((t) => !t.stateMachineState || t.stateMachineState.technicalName !== 'cancelled') || withField[0];
            return relevant ? relevant.customFields[CUSTOM_FIELD] : null;
        },

        postings() {
            const postings = this.infos && Array.isArray(this.infos.postings) ? this.infos.postings : [];
            return [...postings].sort((a, b) => new Date(a.postingDate) - new Date(b.postingDate));
        },

        // Fehlt in Feldern, die Komfortkasse vor der Einfuehrung geschrieben hat. Der Betrag ist dort positiv, in der Tabelle negativ.
        refunds() {
            return this.infos && Array.isArray(this.infos.refunds) ? this.infos.refunds : [];
        },

        rows() {
            const payments = this.postings.map((p) => ({
                date: p.postingDate,
                amount: p.amount,
                currency: p.currency,
                bankFees: p.bankFees,
                refund: false,
            }));
            const refunds = this.refunds.map((r) => ({
                date: r.executionDate,
                amount: -r.amount,
                currency: r.currency,
                bankFees: null,
                refund: true,
            }));
            return [...payments, ...refunds].sort((a, b) => new Date(a.date) - new Date(b.date));
        },

        hasBankFees() {
            return this.rows.some((r) => r.bankFees);
        },

        // nur bei mehreren Zeilen und einheitlicher Waehrung, ueber Waehrungen hinweg waere die Summe falsch
        showRowsSum() {
            return this.rows.length > 1 && this.rows.every((r) => r.currency === this.rows[0].currency);
        },

        rowsSum() {
            return this.rows.reduce((sum, r) => sum + r.amount, 0);
        },

        lastModified() {
            if (!this.infos || !this.infos.lastModified) {
                return null;
            }
            return Shopware.Filter.getByName('date')(this.infos.lastModified);
        },

        // ohne Zahlung gibt es nichts zu erstatten; ohne Karte (kein Feld) entfaellt auch die Abfrage
        refundOrderId() {
            return this.postings.length > 0 ? this.order.id : null;
        },

        showRefundButton() {
            return this.refundAvailable && this.postings.length > 0;
        },
    },

    watch: {
        refundOrderId: {
            immediate: true,
            handler() {
                this.checkRefund();
            },
        },
    },

    methods: {
        checkRefund() {
            this.refundAvailable = false;
            const orderId = this.refundOrderId;
            if (!orderId || !this.acl.can('order_refund.creator')) {
                return;
            }
            this.ltcKomfortkasseRefundLinkService.isRefundLinkAvailable(orderId).then((result) => {
                if (orderId === this.refundOrderId) {
                    this.refundAvailable = !!(result && result.available);
                }
            }).catch(() => {
                this.refundAvailable = false;
            });
        },

        onRefund() {
            // Fenster sofort im Klick oeffnen (sonst greift der Popup-Blocker), die Adresse erst nach dem Abruf setzen: jeder Klick
            // erzeugt ein neues Einmal-Token
            const target = window.open('', '_blank');
            if (target) {
                target.opener = null;
            }
            this.refundLoading = true;
            this.ltcKomfortkasseRefundLinkService.createRefundLink(this.order.id).then((result) => {
                if (result && result.url && target) {
                    target.location.href = result.url;
                    return;
                }
                if (target) {
                    target.close();
                }
                this.createNotificationError({ message: this.$t('ltc-komfortkasse.refund.error') });
            }).catch(() => {
                if (target) {
                    target.close();
                }
                this.createNotificationError({ message: this.$t('ltc-komfortkasse.refund.error') });
            }).finally(() => {
                this.refundLoading = false;
            });
        },

        formatAmount(amount, currency) {
            return Shopware.Filter.getByName('currency')(amount, currency);
        },

        formatPostingDate(value) {
            const date = new Date(value);
            if (!value || Number.isNaN(date.getTime())) {
                return '-';
            }
            return new Intl.DateTimeFormat(Shopware.Store.get('session').currentLocale || undefined, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: POSTING_DATE_TIME_ZONE,
            }).format(date);
        },
    },
});

import template from './ltc-komfortkasse-payment-infos.html.twig';
import './ltc-komfortkasse-payment-infos.scss';

const { Criteria } = Shopware.Data;

const CUSTOM_FIELD = 'komfortkasse';
// Das Buchungsdatum ist eine reine Tagesangabe (Mitternacht deutscher Zeit). In der Zeitzone des Benutzers stuende bei UTC der Vortag da.
const POSTING_DATE_TIME_ZONE = 'Europe/Berlin';
// so oft wird geprueft, ob das Komfortkasse-Fenster geschlossen wurde
const REFUND_WINDOW_POLL_MS = 1000;
// einmal nachladen nach dem Schliessen: Komfortkasse wartet beim Anlegen bis zu 8 s auf das Schreiben des Felds und schreibt danach im Hintergrund weiter
const REFUND_FOLLOW_UP_MS = 10000;

/**
 * Zahlungsdetails aus dem Zusatzfeld "komfortkasse" der Transaktion. Komfortkasse schreibt das Feld, die Karte zeigt es nur an und erscheint
 * nur, wenn es gefuellt ist. lastModified ist die letzte inhaltliche Aenderung, nicht die letzte Pruefung.
 *
 * Die Karte zeigt den Stand der Live-Version: die Bestellung der Detailseite ist eine Arbeitsversion (Kopie beim Oeffnen) und kennt ein inzwischen
 * geschriebenes Feld nicht. Gelesen wird beim Laden der Bestellung, wenn das Komfortkasse-Fenster geschlossen wird (und 10 s spaeter noch einmal)
 * und wenn der Benutzer in diesen Tab zurueckkehrt.
 *
 * Schaltflaeche "Rueckerstattung erfassen": oeffnet die Komfortkasse-Seite zur Bestellung in einem neuen Fenster. Sichtbar nur, wenn Komfortkasse
 * Rueckerstattungen fuer den Shop aktiviert hat und der Bestellung eine Zahlung zugeordnet ist, und nur fuer Benutzer mit dem Recht, Rueckerstattungen
 * anzulegen. Komfortkasse schreibt das Feld nach dem Anlegen in der Regel sofort.
 */
Shopware.Component.register('ltc-komfortkasse-payment-infos', {
    template,

    inject: ['ltcKomfortkasseRefundLinkService', 'acl', 'repositoryFactory'],

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
            // Transaktionen der Live-Version; null = noch nicht gelesen, dann die der Bestellung
            reloadedTransactions: null,
            // nur die Antwort der juengsten Abfrage zaehlt
            reloadRequest: 0,
            // das Fenster selbst steht nicht in data: Vue wuerde es reaktiv verpacken und dabei Eigenschaften lesen, die ein Fenster einer anderen
            // Domain verweigert (SecurityError)
            refundWindowOpen: false,
            refundWindowTimer: null,
            followUpTimer: null,
        };
    },

    computed: {
        infos() {
            const transactions = this.transactions;
            const withField = transactions.filter((t) => t.customFields && t.customFields[CUSTOM_FIELD]);
            const relevant = withField.find((t) => !t.stateMachineState || t.stateMachineState.technicalName !== 'cancelled') || withField[0];
            return relevant ? relevant.customFields[CUSTOM_FIELD] : null;
        },

        transactions() {
            if (this.reloadedTransactions) {
                return this.reloadedTransactions;
            }
            return this.order && this.order.transactions ? Array.from(this.order.transactions) : [];
        },

        postings() {
            const postings = this.infos && Array.isArray(this.infos.postings) ? this.infos.postings : [];
            return [...postings].sort((a, b) => new Date(a.postingDate) - new Date(b.postingDate));
        },

        // Fehlt in Feldern, die Komfortkasse vor der Einfuehrung geschrieben hat. Der Betrag ist dort positiv, in der Tabelle negativ. Ohne executionDate
        // noch nicht ausgefuehrt; zaehlt trotzdem zur Summe, weil Komfortkasse den Betrag schon vom Bezahlten abzieht.
        refunds() {
            return this.infos && Array.isArray(this.infos.refunds) ? this.infos.refunds : [];
        },

        rows() {
            const payments = this.postings.map((p) => ({
                date: p.postingDate,
                amount: p.amount,
                currency: p.currency,
                bankFees: p.bankFees,
                type: 'rowPayment',
            }));
            const refunds = this.refunds.map((r) => ({
                date: r.executionDate,
                amount: -r.amount,
                currency: r.currency,
                bankFees: null,
                type: r.executionDate ? 'rowRefund' : 'rowRefundPending',
            }));
            // noch nicht ausgefuehrte zuletzt
            return [...payments, ...refunds].sort((a, b) => (a.date ? new Date(a.date) : Infinity) - (b.date ? new Date(b.date) : Infinity) || 0);
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

        // Shopware ersetzt die Bestellung beim Laden, nach dem Speichern und beim Neuberechnen, oft wieder aus der alten Arbeitsversion: jedes Mal
        // den Live-Stand lesen. Bei derselben Bestellung bleibt der bisherige Live-Stand stehen, bis die Antwort da ist.
        order: {
            immediate: true,
            handler(newOrder, oldOrder) {
                if (!newOrder || !oldOrder || newOrder.id !== oldOrder.id) {
                    this.reloadedTransactions = null;
                }
                this.reloadInfos();
            },
        },
    },

    created() {
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    },

    beforeUnmount() {
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.stopWatchingRefundWindow();
        this.clearFollowUp();
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
                    this.watchRefundWindow(target);
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

        // Die Komfortkasse-Seite kann diesen Tab nicht benachrichtigen (opener ist geloescht), "closed" laesst sich aber auch ueber Domains hinweg abfragen.
        watchRefundWindow(target) {
            this.stopWatchingRefundWindow();
            this.clearFollowUp();
            this.refundWindowOpen = true;
            this.refundWindowTimer = window.setInterval(() => {
                if (target.closed) {
                    this.stopWatchingRefundWindow();
                    this.reloadInfos();
                    this.followUpTimer = window.setTimeout(() => {
                        this.followUpTimer = null;
                        this.reloadInfos();
                    }, REFUND_FOLLOW_UP_MS);
                }
            }, REFUND_WINDOW_POLL_MS);
        },

        stopWatchingRefundWindow() {
            if (this.refundWindowTimer) {
                window.clearInterval(this.refundWindowTimer);
            }
            this.refundWindowTimer = null;
            this.refundWindowOpen = false;
        },

        clearFollowUp() {
            if (this.followUpTimer) {
                window.clearTimeout(this.followUpTimer);
            }
            this.followUpTimer = null;
        },

        // Das Fenster ist meist ein Tab: wer nicht schliesst, sondern nur zurueckwechselt, bekommt den neuen Stand auch
        onVisibilityChange() {
            if (document.visibilityState === 'visible' && this.refundWindowOpen) {
                this.reloadInfos();
            }
        },

        // Transaktionen der Live-Version (Shopware.Context.api ohne Arbeitsversion). Die Bestellung selbst bleibt unberuehrt, ungespeicherte
        // Aenderungen gehen nicht verloren.
        reloadInfos() {
            if (!this.order || !this.order.id) {
                return;
            }
            const orderId = this.order.id;
            const request = ++this.reloadRequest;
            const criteria = new Criteria(1, 25);
            criteria.addFilter(Criteria.equals('orderId', orderId));
            criteria.addAssociation('stateMachineState');
            this.repositoryFactory.create('order_transaction').search(criteria, Shopware.Context.api).then((result) => {
                if (request === this.reloadRequest && this.order && this.order.id === orderId) {
                    this.reloadedTransactions = Array.from(result);
                }
            }).catch(() => {
                // Karte behaelt den bisherigen Stand
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

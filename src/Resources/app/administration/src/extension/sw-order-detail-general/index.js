import template from './sw-order-detail-general.html.twig';

/** Karte mit den Zahlungsdetails aus Komfortkasse direkt unter den allgemeinen Angaben der Bestellung */
Shopware.Component.override('sw-order-detail-general', {
    template,
});

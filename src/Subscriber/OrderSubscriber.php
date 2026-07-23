<?php
declare(strict_types = 1)
    ;

namespace Ltc\Komfortkasse\Subscriber;

use Shopware\Core\Checkout\Order\OrderEvents;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\EntityWriteResult;
use Shopware\Core\Framework\DataAbstractionLayer\Event\EntityWrittenEvent;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

class OrderSubscriber implements EventSubscriberInterface
{

    /**
     * Felder der Bestellung, deren Aenderung Komfortkasse zeitnah braucht.
     * Betrag: 'price' - amountTotal/amountNet/positionPrice sind WriteProtected und stehen nie im Payload.
     * Alles andere (updatedAt, customFields, Versand- und Zahlstatus, ...) wird nicht gemeldet.
     */
    private const RELEVANT_ORDER_FIELDS = [ 'price', 'stateId', 'orderNumber'
    ];

    /** Der DAL bildet den Event-Namen generisch als entityName . '.written' */
    private const DOCUMENT_WRITTEN_EVENT = 'document.written';

    /** @var SystemConfigService */
    private $systemConfigService;

    /** @var EntityRepository */
    private $orderRepo;


    public function __construct(SystemConfigService $systemConfigService, EntityRepository $orderRepo)
    {
        $this->systemConfigService = $systemConfigService;
        $this->orderRepo = $orderRepo;

    }


    public static function getSubscribedEvents(): array


    {
        return [ OrderEvents::ORDER_WRITTEN_EVENT => 'onOrderWritten',self::DOCUMENT_WRITTEN_EVENT => 'onDocumentWritten'
        ];

    }


    public function onOrderWritten(EntityWrittenEvent $event)
    {
        $orderIds = array ();
        foreach ($event->getWriteResults() as $result) {
            $id = $result->getPrimaryKey();
            if (!is_string($id) || in_array($id, $orderIds))
                continue;

            // neue Bestellung: immer melden
            if ($result->getOperation() === EntityWriteResult::OPERATION_INSERT) {
                $orderIds [] = $id;
                continue;
            }
            if ($result->getOperation() !== EntityWriteResult::OPERATION_UPDATE)
                continue;

            // Aenderung: nur melden, wenn ein fuer Komfortkasse relevantes Feld betroffen ist
            foreach (self::RELEVANT_ORDER_FIELDS as $field) {
                if ($result->hasPayload($field)) {
                    $orderIds [] = $id;
                    break;
                }
            }
        }

        $this->notifyKomfortkasse($orderIds, $event->getContext());

    }


    public function onDocumentWritten(EntityWrittenEvent $event)
    {
        $orderIds = array ();
        foreach ($event->getWriteResults() as $result) {
            // Dokumente werden angelegt, nicht geaendert. Nach dem Typ (Rechnung, Storno, ...) wird bewusst nicht
            // gefiltert: welche Typen als Rechnungsnummer zaehlen, steht in der Komfortkasse-Konfiguration und ist
            // hier nicht bekannt. Dokumente entstehen selten, deshalb wird jedes gemeldet.
            if ($result->getOperation() !== EntityWriteResult::OPERATION_INSERT)
                continue;

            $payload = $result->getPayload();
            if (!isset($payload ['orderId']))
                continue;

            $orderId = $payload ['orderId'];
            if (is_string($orderId) && !in_array($orderId, $orderIds))
                $orderIds [] = $orderId;
        }

        $this->notifyKomfortkasse($orderIds, $event->getContext());

    }


    private function notifyKomfortkasse(array $orderIds, Context $context)
    {
        if (!$orderIds)
            return;

        $active = $this->systemConfigService->get('LtcKomfortkasse6.config.active');
        if (!$active)
            return;

        // ein Batch-Write liefert alle Ergebnisse in einem Event: EIN search() fuer alle IDs statt einem pro Ergebnis
        $orderCriteria = new Criteria($orderIds);
        $orderCriteria->addAssociation('salesChannel.domains');
        $orderCriteria->addAssociation('transactions.paymentMethod');
        $orders = $this->orderRepo->search($orderCriteria, $context)->getEntities();

        foreach ($orders as $order) {
            $urls = array ();
            $channel = $order->getSalesChannel();
            if (!$channel)
                continue;
            if (!$this->systemConfigService->get('LtcKomfortkasse6.config.active', $channel->getId()))
                continue;

            foreach ($channel->getDomains() as $domain) {
                $urls [] = $domain->getUrl();
            }

            $paymentMethods = array();
            foreach ($order->getTransactions() as $t) {
                if (!in_array($t->getPaymentMethodId(), $paymentMethods))
                    $paymentMethods [] = $t->getPaymentMethodId();
                if ($t->getPaymentMethod() && !in_array($t->getPaymentMethod()->getFormattedHandlerIdentifier(), $paymentMethods))
                    $paymentMethods [] = $t->getPaymentMethod()->getFormattedHandlerIdentifier();
            }

            $query = http_build_query(array ('id' => $order->getId(),'url' => $urls, 'payment_method' => $paymentMethods));
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_URL, 'https://ssl.komfortkasse.eu/api/shop/neworder.jsf');
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_NOSIGNAL, 1);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 0);
            curl_setopt($ch, CURLOPT_TIMEOUT_MS, 1001);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $query);
            @curl_exec($ch);
            @curl_close ($ch);
        }

    }
}

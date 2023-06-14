<?php
declare(strict_types = 1)
    ;

namespace Ltc\Komfortkasse\Subscriber;

use Shopware\Core\Checkout\Order\OrderEvents;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepositoryInterface;
use Shopware\Core\Framework\DataAbstractionLayer\Event\EntityWrittenEvent;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

class OrderSubscriber implements EventSubscriberInterface
{

    /** @var SystemConfigService */
    private $systemConfigService;

    /** @var EntityRepositoryInterface */
    private $orderRepo;


    public function __construct(SystemConfigService $systemConfigService, EntityRepositoryInterface $orderRepo)
    {
        $this->systemConfigService = $systemConfigService;
        $this->orderRepo = $orderRepo;

    }


    public static function getSubscribedEvents(): array


    {
        return [ OrderEvents::ORDER_WRITTEN_EVENT => 'onInsertOrder'
        ];

    }


    public function onInsertOrder(EntityWrittenEvent $event)
    {
        $active = $this->systemConfigService->get('LtcKomfortkasse6.config.active');
        if (!$active)
            return;

        foreach ($event->getWriteResults() as $result) {

            $orderCriteria = new Criteria([ $result->getPrimaryKey()
            ]);
            $orderCriteria->addAssociation('salesChannel.domains');
            $orderCriteria->addAssociation('transactions.paymentMethod');
            $orders = $this->orderRepo->search($orderCriteria, $event->getContext())->getEntities();

            foreach ($orders as $order) {
                $urls = array ();
                $channel = $order->getSalesChannel();
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
}
<?php
declare(strict_types = 1)
    ;

namespace Ltc\Komfortkasse\Controller;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Connections\PrimaryReadReplicaConnection;
use Shopware\Core\Checkout\Order\OrderEntity;
use Shopware\Core\Defaults;
use Shopware\Core\Framework\Api\Context\AdminApiSource;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Shopware\Core\Framework\Uuid\Uuid;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Link "Rueckerstattung erfassen" in der Bestellung der Administration.
 *
 * Komfortkasse schreibt seine Shop-ID in die Plugin-Konfiguration, sobald Rueckerstattungen fuer den Shop aktiviert sind. Beim Klick
 * erzeugt diese Route ein Einmal-Token und den Link zur Komfortkasse-Seite. Komfortkasse prueft das Token ueber die Admin-API bei diesem
 * Shop (verify) und verbraucht es beim Anlegen der Rueckerstattung. Es gibt kein gemeinsames Geheimnis: die Systemkonfiguration koennen
 * auch Rollen und Apps ohne Bestellrechte lesen, die Zusatzfelder der Bestellung sogar der Kunde ueber die Store API.
 */
#[Route(defaults: ['_routeScope' => ['api']])]
class RefundLinkController extends AbstractController
{

    private const CONFIG_ACTIVE = 'LtcKomfortkasse6.config.active';

    private const CONFIG_SHOP_ID = 'LtcKomfortkasse6.config.refundLinkShopId';

    /** nur zum Testen gegen ein anderes Komfortkasse-System, siehe getBaseUrl() */
    private const CONFIG_BASE_URL = 'LtcKomfortkasse6.config.refundLinkBaseUrl';

    private const DEFAULT_BASE_URL = 'https://ssl.komfortkasse.eu';

    private const PATH = '/public/shopRefund.jsf';

    private const ORDER_PATH = '/sec/login.jsf';

    /** Zusatzfeld der Transaktion, das Komfortkasse zu Bestellungen mit verarbeiteter Zahlung schreibt */
    private const CUSTOM_FIELD = 'komfortkasse';

    private const TABLE = 'ltc_komfortkasse_refund_link_token';

    /** laengste Gueltigkeit, die Komfortkasse beim Pruefen verlangen kann (Absenden des Formulars) */
    private const MAX_AGE_SECONDS = 7200;

    /** @var SystemConfigService */
    private $systemConfigService;

    /** @var EntityRepository */
    private $orderRepo;

    /** @var Connection */
    private $connection;


    public function __construct(SystemConfigService $systemConfigService, EntityRepository $orderRepo, Connection $connection)
    {
        $this->systemConfigService = $systemConfigService;
        $this->orderRepo = $orderRepo;
        $this->connection = $connection;

    }


    /**
     * Mit ?check=1: {"available": true|false}, ob die Schaltflaeche angezeigt wird (ohne Token).
     * Sonst: {"url": "..."} mit neuem Token oder {"url": null}, wenn ueber Komfortkasse keine Rueckerstattung moeglich ist.
     */
    #[Route(path: '/api/_action/ltc-komfortkasse/refund-link/{orderId}', name: 'api.action.ltc_komfortkasse.refund_link', defaults: ['_acl' => ['order:read', 'order_transaction_capture_refund:create']], methods: ['GET'])]
    public function refundLink(string $orderId, Request $request, Context $context): JsonResponse
    {
        $check = $request->query->getBoolean('check');
        $order = Uuid::isValid($orderId) ? $this->loadOrder($orderId, $context) : null;
        $shopId = $order === null ? '' : $this->systemConfigService->getString(self::CONFIG_SHOP_ID, $order->getSalesChannelId());
        $baseUrl = $order === null ? '' : $this->getBaseUrl($order->getSalesChannelId());
        $available = $order !== null && preg_match('/^[0-9]{1,18}$/', $shopId) === 1 && $baseUrl !== '' && $this->hasKomfortkassePayment($order);

        if ($check)
            return new JsonResponse([ 'available' => $available ]);
        if (!$available)
            return new JsonResponse([ 'url' => null ]);

        $token = bin2hex(random_bytes(32));
        $source = $context->getSource();
        $userId = $source instanceof AdminApiSource ? $source->getUserId() : null;
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->connection->executeStatement('DELETE FROM `' . self::TABLE . '` WHERE `created_at` < :before', [ 'before' => $now->modify('-1 day')->format(Defaults::STORAGE_DATE_TIME_FORMAT) ]);
        $this->connection->insert(self::TABLE, [ 'token_hash' => hash('sha256', $token),'order_id' => Uuid::fromHexToBytes($order->getId()),'user_id' => $userId === null ? null : Uuid::fromHexToBytes($userId),
            'created_at' => $now->format(Defaults::STORAGE_DATE_TIME_FORMAT) ]);

        $query = http_build_query([ 'shop' => $shopId,'order' => $order->getId(),'token' => $token ]);
        return new JsonResponse([ 'url' => $baseUrl . self::PATH . '?' . $query ]);

    }


    /**
     * Link "In Komfortkasse oeffnen": {"url": "..."} oder {"url": null}, wenn das Plugin fuer den Verkaufskanal nicht aktiv ist.
     * Gilt fuer alle Bestellungen, auch unbezahlte (das Zusatzfeld gibt es erst nach einem Status-Update): das Plugin weiss nicht, welche
     * Zahlungsarten Komfortkasse verarbeitet. Kennt Komfortkasse die Bestellung nicht, bleibt die gefilterte Bestellliste leer.
     * Die Bestell-ID unterscheidet gleiche Nummern in mehreren Shops des Haendlers; Komfortkasse sucht zuerst danach, dann nach der Nummer.
     * Braucht kein Token: die Bestellung oeffnet sich erst nach der Anmeldung im Haendlerbereich und nur beim Haendler, dem sie gehoert.
     */
    #[Route(path: '/api/_action/ltc-komfortkasse/order-link/{orderId}', name: 'api.action.ltc_komfortkasse.order_link', defaults: ['_acl' => ['order:read']], methods: ['GET'])]
    public function orderLink(string $orderId, Context $context): JsonResponse
    {
        $order = Uuid::isValid($orderId) ? $this->loadOrder($orderId, $context) : null;
        if ($order === null || empty($order->getOrderNumber()) || !$this->systemConfigService->get(self::CONFIG_ACTIVE, $order->getSalesChannelId()))
            return new JsonResponse([ 'url' => null ]);

        $query = http_build_query([ 'redirect' => 'orders.jsf','orderNumber' => $order->getOrderNumber(),'orderId' => $order->getId() ]);
        return new JsonResponse([ 'url' => $this->getBaseUrl($order->getSalesChannelId()) . self::ORDER_PATH . '?' . $query ]);

    }


    /**
     * Prueft ein Token fuer Komfortkasse: Body {"orderId", "token", "maxAge" (Sekunden), "consume" (true = danach ungueltig)}.
     * Antwort {"valid": true|false}. Komfortkasse ruft mit dem Zugangsschluessel des Shops auf (Integration oder Benutzer); wer kein Token
     * kennt, erfaehrt hier nichts.
     */
    #[Route(path: '/api/_action/ltc-komfortkasse/refund-link-token/verify', name: 'api.action.ltc_komfortkasse.refund_link_token_verify', defaults: ['_acl' => ['order:read']], methods: ['POST'])]
    public function verifyToken(Request $request, Context $context): JsonResponse
    {
        $orderId = (string) $request->request->get('orderId', '');
        $token = (string) $request->request->get('token', '');
        $maxAge = min(max((int) $request->request->get('maxAge', 0), 0), self::MAX_AGE_SECONDS);
        $consume = $request->request->getBoolean('consume');
        if (!Uuid::isValid($orderId) || preg_match('/^[0-9a-f]{64}$/', $token) !== 1 || $maxAge === 0)
            return new JsonResponse([ 'valid' => false ]);

        $params = [ 'hash' => hash('sha256', $token),'orderId' => Uuid::fromHexToBytes(strtolower($orderId)),
            'after' => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->modify('-' . $maxAge . ' seconds')->format(Defaults::STORAGE_DATE_TIME_FORMAT) ];
        $where = 'WHERE `token_hash` = :hash AND `order_id` = :orderId AND `created_at` >= :after';
        // das Token wurde eben erst auf der Primaerdatenbank angelegt, eine Lese-Replik kennt es vielleicht noch nicht
        if ($this->connection instanceof PrimaryReadReplicaConnection)
            $this->connection->ensureConnectedToPrimary();
        if ($consume)
            $valid = $this->connection->executeStatement('DELETE FROM `' . self::TABLE . '` ' . $where, $params) === 1;
        else
            $valid = $this->connection->fetchOne('SELECT 1 FROM `' . self::TABLE . '` ' . $where, $params) !== false;

        return new JsonResponse([ 'valid' => $valid ]);

    }


    private function loadOrder(string $orderId, Context $context): ?OrderEntity
    {
        $criteria = new Criteria([ $orderId ]);
        $criteria->addAssociation('transactions');
        return $this->orderRepo->search($criteria, $context)->getEntities()->first();

    }


    /**
     * Die Adresse traegt das Token. Die Systemkonfiguration koennen auch Rollen ohne Erstattungsrecht schreiben, deshalb gilt eine abweichende Adresse
     * nur fuer Komfortkasse selbst und lokale Testsysteme, sonst immer die Standardadresse.
     */
    private function getBaseUrl(string $salesChannelId): string
    {
        $url = rtrim($this->systemConfigService->getString(self::CONFIG_BASE_URL, $salesChannelId), '/');
        if (preg_match('#^https://([a-z0-9-]+\.)*komfortkasse\.eu(/[A-Za-z0-9._~/-]*)?$#', $url) === 1)
            return $url;
        if (preg_match('#^https?://(localhost|127\.0\.0\.1|[a-z0-9.-]+\.(localhost|test|ddev\.site))(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$#', $url) === 1)
            return $url;
        return self::DEFAULT_BASE_URL;

    }


    private function hasKomfortkassePayment(OrderEntity $order): bool
    {
        $transactions = $order->getTransactions();
        if ($transactions === null)
            return false;
        foreach ($transactions as $t) {
            $customFields = $t->getCustomFields();
            if (is_array($customFields) && !empty($customFields [self::CUSTOM_FIELD]))
                return true;
        }
        return false;

    }
}

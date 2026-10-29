<?php
declare(strict_types = 1)
    ;

namespace Ltc\Komfortkasse\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

/**
 * Einmal-Token fuer den Link "Rueckerstattung erfassen", siehe RefundLinkController. Bewusst eine Tabelle ohne DAL-Definition: die
 * Admin-API (Suche, Systemkonfiguration) gibt sie nicht aus, nur die beiden Routen des Plugins lesen und schreiben sie.
 */
class Migration1793268000RefundLinkToken extends MigrationStep
{

    public function getCreationTimestamp(): int
    {
        return 1793268000;

    }


    public function update(Connection $connection): void
    {
        $connection->executeStatement('
            CREATE TABLE IF NOT EXISTS `ltc_komfortkasse_refund_link_token` (
                `token_hash` CHAR(64) NOT NULL,
                `order_id` BINARY(16) NOT NULL,
                `user_id` BINARY(16) NULL,
                `created_at` DATETIME(3) NOT NULL,
                PRIMARY KEY (`token_hash`),
                KEY `idx.ltc_komfortkasse_refund_link_token.created_at` (`created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ');

    }


    public function updateDestructive(Connection $connection): void
    {

    }
}

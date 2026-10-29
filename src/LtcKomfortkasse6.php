<?php
namespace Ltc\Komfortkasse;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Plugin;
use Shopware\Core\Framework\Plugin\Context\UninstallContext;

class LtcKomfortkasse6 extends Plugin
{

    public function uninstall(UninstallContext $uninstallContext): void
    {
        parent::uninstall($uninstallContext);
        if ($uninstallContext->keepUserData())
            return;

        $connection = $this->container->get(Connection::class);
        // nur kurzlebige Einmal-Token fuer den Link "Rueckerstattung erfassen"
        $connection->executeStatement('DROP TABLE IF EXISTS `ltc_komfortkasse_refund_link_token`');
        // von Komfortkasse geschriebene Werte stehen nicht in der config.xml und werden von Shopware deshalb nicht entfernt
        $connection->executeStatement("DELETE FROM `system_config` WHERE `configuration_key` IN ('LtcKomfortkasse6.config.refundLinkShopId', 'LtcKomfortkasse6.config.refundLinkBaseUrl')");

    }
}

const { ApiService } = Shopware.Classes;

/**
 * Link "Rueckerstattung erfassen" zu Komfortkasse, siehe RefundLinkController.
 */
class LtcKomfortkasseRefundLinkService extends ApiService {
    constructor(httpClient, loginService, apiEndpoint = 'ltc-komfortkasse') {
        super(httpClient, loginService, apiEndpoint);
        this.name = 'ltcKomfortkasseRefundLinkService';
    }

    /** @returns {Promise<{available: boolean}>} ob die Schaltflaeche angezeigt wird, ohne Token */
    isRefundLinkAvailable(orderId) {
        return this.httpClient
            .get(`_action/${this.getApiBasePath()}/refund-link/${orderId}`, { params: { check: 1 }, headers: this.getBasicHeaders() })
            .then((response) => ApiService.handleResponse(response));
    }

    /** @returns {Promise<{url: string|null}>} Link mit neuem Einmal-Token */
    createRefundLink(orderId) {
        return this.httpClient
            .get(`_action/${this.getApiBasePath()}/refund-link/${orderId}`, { headers: this.getBasicHeaders() })
            .then((response) => ApiService.handleResponse(response));
    }

    /** @returns {Promise<{url: string|null}>} Link "In Komfortkasse oeffnen", null = keine Schaltflaeche */
    getOrderLink(orderId) {
        return this.httpClient
            .get(`_action/${this.getApiBasePath()}/order-link/${orderId}`, { headers: this.getBasicHeaders() })
            .then((response) => ApiService.handleResponse(response));
    }
}

Shopware.Service().register('ltcKomfortkasseRefundLinkService', (container) => {
    const initContainer = Shopware.Application.getContainer('init');
    return new LtcKomfortkasseRefundLinkService(initContainer.httpClient, container.loginService);
});

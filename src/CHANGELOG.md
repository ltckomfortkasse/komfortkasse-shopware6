# 1.6.0
- initial version for Shopware 6, based on v1.5.11

# 1.6.1
- bugfix for error 'Failed to start the session because headers have already been sent'

# 1.6.2
- performance improvements (fewer API calls)

# 1.6.3
- Shopware 6.5 compatibility

# 1.6.4
- only notify Komfortkasse on new orders and on relevant changes (amount, order state, order number) instead of on every write
- notify Komfortkasse when a document is created, so invoice numbers arrive without waiting for the next full read
- fewer database queries when many orders are written at once

# 1.7.0
- requires Shopware 6.7
- button 'Create refund' in the order detail of the administration: opens the Komfortkasse page to create a refund for the order (only if refunds are enabled for the shop in Komfortkasse)

# 1.7.1
- button 'Open in Komfortkasse' in the order detail of the administration: opens the order in the Komfortkasse merchant area (for all orders, if the plugin is active for the sales channel)

# 1.7.2
- button 'Open in Komfortkasse': the link also contains the order id, so the right order opens if a merchant has the same order number in several shops

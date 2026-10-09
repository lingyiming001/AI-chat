ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_balance_nonnegative" CHECK ("balance" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_amount_positive" CHECK ("amountCents" > 0 AND "coins" > 0);
ALTER TABLE "Character" ADD CONSTRAINT "Character_price_positive" CHECK ("pricePerMessage" > 0);
ALTER TABLE "ChatRequest" ADD CONSTRAINT "ChatRequest_status_valid" CHECK ("status" IN ('PENDING', 'COMPLETED', 'FAILED'));

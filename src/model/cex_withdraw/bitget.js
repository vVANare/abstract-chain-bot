import ccxt from "ccxt";
import logger from "../../utils/logger.js";
import { ethers } from "ethers";
const NETWORK_MAPPING = {
    Arbitrum: "Arbitrum One",
};
export class BitgetWithdraw {
    accountIndex;
    privateKey;
    config;
    exchange;
    wallet;
    address;
    constructor(accountIndex, privateKey, config) {
        this.accountIndex = accountIndex;
        this.privateKey = privateKey;
        this.config = config;
        // Initialize Bitget exchange
        this.exchange = new ccxt.bitget({
            apiKey: this.config.withdraw.api_key,
            secret: this.config.withdraw.secret_key,
            password: this.config.withdraw.password,
            enableRateLimit: true,
        });
        this.wallet = new ethers.Wallet(privateKey);
        this.address = this.wallet.address;
    }
    /**
     * Withdraw ETH from Bitget using config settings
     * @returns Withdrawal transaction details
     */
    async withdraw() {
        try {
            logger.info(`${this.accountIndex} | ${this.address} | Starting Bitget withdrawal`);
            // Get initial balance
            const provider = new ethers.JsonRpcProvider(this.config.rpcs.arbitrum_rpc[0]);
            const initialBalance = await provider.getBalance(this.address);
            logger.info(`${this.accountIndex} | ${this.address} | Initial balance: ${ethers.formatEther(initialBalance)} ETH`);
            // Get random amount from config range
            const amount = this.getRandomAmount();
            // Execute withdrawal
            const withdrawal = await this.exchange.withdraw("ETH", amount, this.address, undefined, {
                network: "ArbitrumOne",
                chain: "ArbitrumOne",
            });
            logger.success(`${this.accountIndex} | ${this.address} | Successfully withdrew from Bitget!`);
            // Wait for deposit to be received (max 7 minutes)
            const maxAttempts = 42; // 42 attempts * 10 seconds = 7 minutes
            let attempts = 0;
            while (attempts < maxAttempts) {
                const currentBalance = await provider.getBalance(this.address);
                if (currentBalance > initialBalance) {
                    const received = ethers.formatEther(currentBalance - initialBalance);
                    logger.success(`${this.accountIndex} | ${this.address} | Deposit received: ${received} ETH`);
                    break;
                }
                attempts++;
                if (attempts === maxAttempts) {
                    logger.error(`${this.accountIndex} | ${this.address} | Deposit not received after 7 minutes`);
                    return false;
                }
                if (attempts % 6 === 0) {
                    // Log every minute
                    logger.info(`${this.accountIndex} | ${this.address} | Waiting for deposit... ${attempts / 6} minute(s)`);
                }
                await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
            }
            await this.exchange.close();
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error withdrawing from Bitget: ${error}`);
            return false;
        }
    }
    getRandomAmount() {
        const [min, max] = this.config.withdraw.amount;
        // Get random amount and format to 8 decimal places
        const randomAmount = Math.random() * (max - min) + min;
        return parseFloat(randomAmount.toFixed(8));
    }
}

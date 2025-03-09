import winston from "winston";
export class Logger {
    logger;
    constructor() {
        const customLevels = {
            error: 0,
            warn: 1,
            info: 2,
            success: 3,
        };
        const customColors = {
            error: "red",
            warn: "yellow",
            info: "white",
            success: "green",
            timestamp: "cyan",
        };
        winston.addColors(customColors);
        const myFormat = winston.format.printf((info) => {
            let currentDate = new Date();
            let formattedTime = [
                ("0" + currentDate.getHours()).slice(-2),
                ("0" + currentDate.getMinutes()).slice(-2),
                ("0" + currentDate.getSeconds()).slice(-2),
            ].join(":");
            return `${winston.format
                .colorize()
                .colorize("timestamp", formattedTime)} | ${info.level}: ${info.message}`;
        });
        this.logger = winston.createLogger({
            levels: customLevels,
            format: winston.format.combine(winston.format.colorize({ all: true }), myFormat),
            defaultMeta: { service: "user-service" },
            transports: [new winston.transports.Console({ level: "success" })],
        });
    }
    info(...args) {
        this.logger.info(args.join(" "));
    }
    error(...args) {
        this.logger.error(args.join(" "));
    }
    success(...args) {
        this.logger.success(args.join(" "));
    }
}
export default new Logger();

import { hostname } from "node:os"
import pino, { type Logger } from "pino"

export type AppLogger = Logger

const LogLevel = {
	Trace: "trace",
	Debug: "debug",
	Info: "info",
	Warn: "warn",
	Error: "error",
	Fatal: "fatal",
	Silent: "silent",
} as const
type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

export const logger = pino({
	base: {
		hostname: hostname(),
		pid: process.pid,
		service: "freya-backend",
	},
	level: readLogLevel(process.env.LOG_LEVEL, process.env.NODE_ENV),
	transport:
		readLogFormat(process.env.LOG_FORMAT, process.env.NODE_ENV) === "pretty"
			? {
					target: "pino-pretty",
					options: {
						colorize: true,
						ignore: "hostname,pid",
						singleLine: false,
						translateTime: "SYS:standard",
					},
				}
			: undefined,
	redact: {
		censor: "[redacted]",
		paths: [
			"apiKey",
			"authorization",
			"cookie",
			"credentialEncryptionKey",
			"password",
			"privateKey",
			"*.apiKey",
			"*.authorization",
			"*.cookie",
			"*.credentialEncryptionKey",
			"*.password",
			"*.privateKey",
		],
	},
	serializers: {
		err: pino.stdSerializers.err,
	},
})

function readLogFormat(value: string | undefined, nodeEnv: string | undefined): "json" | "pretty" {
	const normalized = value?.trim().toLowerCase()
	if (normalized === "json") {
		return "json"
	}
	if (nodeEnv === "test") {
		return "json"
	}
	return "pretty"
}

function readLogLevel(value: string | undefined, nodeEnv: string | undefined): LogLevel {
	const normalized = value?.trim().toLowerCase()
	switch (normalized) {
		case LogLevel.Trace:
		case LogLevel.Debug:
		case LogLevel.Info:
		case LogLevel.Warn:
		case LogLevel.Error:
		case LogLevel.Fatal:
		case LogLevel.Silent:
			return normalized
		default:
			return nodeEnv === "test" ? LogLevel.Silent : LogLevel.Info
	}
}

/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
import cronParser from "cron-parser";
import path from "path";
import fs from "fs";
import _glob from "glob";
import { promisify } from "util";
import schedule from "node-schedule";
import _logger from "../logger";
import state from "../kmq";
import { EMBED_INFO_COLOR, sendInfoMessage } from "./discord_utils";
import readyHandler from "../events/client/ready";
import messageCreateHandler from "../events/client/messageCreate";
import voiceChannelLeaveHandler from "../events/client/voiceChannelLeave";
import voiceChannelSwitchHandler from "../events/client/voiceChannelSwitch";
import connectHandler from "../events/client/connect";
import errorHandler from "../events/client/error";
import warnHandler from "../events/client/warn";
import shardDisconnectHandler from "../events/client/shardDisconnect";
import shardReadyHandler from "../events/client/shardReady";
import shardResumeHandler from "../events/client/shardResume";
import disconnectHandler from "../events/client/disconnect";
import unhandledRejectionHandler from "../events/process/unhandledRejection";
import uncaughtExceptionHandler from "../events/process/uncaughtException";
import SIGINTHandler from "../events/process/SIGINT";
import { cleanupInactiveGameSessions } from "./game_utils";
import dbContext from "../database_context";
import BaseCommand from "../commands/base_command";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import debugHandler from "../events/client/debug";
import guildCreateHandler from "../events/client/guildCreate";
import BotStatsPoster from "./bot_stats_poster";
import { EnvType } from "../types";
import storeDailyStats from "../scripts/store-daily-stats";
import { seedAndDownloadNewSongs } from "../seed/seed_db";
import backupKmqDatabase from "../scripts/backup-kmq-database";
import { parseJsonFile } from "./utils";
import { reloadFactCache } from "../fact_generator";
import MessageContext from "../structures/message_context";

const glob = promisify(_glob);

const logger = _logger("management_utils");

const RESTART_WARNING_INTERVALS = new Set([10, 5, 2, 1]);

const publishOverridesFilePath = path.resolve(__dirname, "../../data/publish_date_overrides.json");
const songAliasesFilePath = path.resolve(__dirname, "../../data/song_aliases.json");
const artistAliasesFilePath = path.resolve(__dirname, "../../data/artist_aliases.json");
let cachedCommandFiles: { [commandName: string]: BaseCommand } = null;

/** Registers listeners on client events */
export function registerClientEvents() {
    const { client } = state;
    client.on("ready", readyHandler)
        .on("messageCreate", messageCreateHandler)
        .on("voiceChannelLeave", voiceChannelLeaveHandler)
        .on("voiceChannelSwitch", voiceChannelSwitchHandler)
        .on("connect", connectHandler)
        .on("error", errorHandler)
        .on("warn", warnHandler)
        .on("shardDisconnect", shardDisconnectHandler)
        .on("shardReady", shardReadyHandler)
        .on("shardResume", shardResumeHandler)
        .on("disconnect", disconnectHandler)
        // .on("debug", debugHandler)
        .on("guildCreate", guildCreateHandler);
}

/** Registers listeners on process events */
export function registerProcessEvents() {
    process.on("unhandledRejection", unhandledRejectionHandler)
        .on("uncaughtException", uncaughtExceptionHandler)
        .on("SIGINT", SIGINTHandler);
}

/**
 * Sends a warning message to all active GameSessions for impending restarts at predefined intervals
 * @param restartNotification - The date of the impending restart
 */
export const checkRestartNotification = async (restartNotification: Date): Promise<void> => {
    const timeDiffMin = Math.floor((restartNotification.getTime() - (new Date()).getTime()) / (1000 * 60));
    let channelsWarned = 0;
    if (RESTART_WARNING_INTERVALS.has(timeDiffMin)) {
        for (const gameSession of Object.values(state.gameSessions)) {
            if (gameSession.finished) continue;
            await sendInfoMessage(new MessageContext(gameSession.textChannelID), {
                color: EMBED_INFO_COLOR,
                author: {
                    username: state.client.user.username,
                    avatarUrl: state.client.user.avatarURL,
                },
                title: `Upcoming bot restart in ${timeDiffMin} minutes.`,
                description: "Downtime will be approximately 2 minutes.",
            });
            channelsWarned++;
        }
        logger.info(`Impending bot restart in ${timeDiffMin} minutes. ${channelsWarned} servers warned.`);
    }
};

/** Updates the bot's server count status */
export function updateBotStatus() {
    const { client } = state;
    client.editStatus("online", {
        name: `over ${Math.floor(client.guilds.size / 100) * 100} servers`,
        type: 3,
    });
}

/** Applies publish date overrides to available_songs table */
export async function updatePublishDateOverrides() {
    try {
        const publishDateOverrides = parseJsonFile(publishOverridesFilePath);
        for (const [videoID, dateOverride] of Object.entries(publishDateOverrides)) {
            await dbContext.kmq("available_songs")
                .update({ publishedon: dateOverride })
                .where("link", "=", videoID);
        }
    } catch (err) {
        logger.error("Error parsing publish overrides file");
    }
}
/** Reload song/artist aliases */
export function reloadAliases() {
    try {
        state.aliases.song = parseJsonFile(songAliasesFilePath);
        state.aliases.artist = parseJsonFile(artistAliasesFilePath);
        logger.info("Reloaded song and artist alias data");
    } catch (err) {
        logger.error("Error parsing alias files");
        state.aliases.song = {};
        state.aliases.artist = {};
    }
}

/** Sets up recurring cron-based tasks */
export function registerIntervals() {
    // set up cleanup for inactive game sessions
    schedule.scheduleJob("*/10 * * * *", () => {
        cleanupInactiveGameSessions();
        updateBotStatus();
    });

    // set up check for restart notifications
    schedule.scheduleJob("* * * * *", async () => {
        // unscheduled restarts
        const restartNotification = (await dbContext.kmq("restart_notifications").where("id", 1))[0].restart_time;
        if (restartNotification) {
            const restartNotificationTime = new Date(restartNotification);
            if (restartNotificationTime.getTime() > Date.now()) {
                await checkRestartNotification(restartNotificationTime);
                return;
            }
        }

        // cron based restart
        if (process.env.RESTART_CRON) {
            const interval = cronParser.parseExpression(process.env.RESTART_CRON);
            const nextRestartTime = interval.next();
            await checkRestartNotification(nextRestartTime.toDate());
        }
    });

    // everyday at 12am UTC => 7pm EST
    schedule.scheduleJob("0 0 * * *", async () => {
        const serverCount = state.client.guilds.size;
        storeDailyStats(serverCount);
        reloadFactCache();
    });

    // everyday at 7am UTC => 2am EST
    schedule.scheduleJob("0 7 * * *", async () => {
        logger.info("Performing regularly scheduled Daisuki database seed");
        const overrideFileExists = fs.existsSync(path.join(__dirname, "../../data/skip_seed"));
        if (overrideFileExists) {
            return;
        }
        await seedAndDownloadNewSongs();
    });

    // every sunday at 1am UTC => 8pm saturday EST
    schedule.scheduleJob("0 1 * * 0", async () => {
        logger.info("Backing up kmq database");
        await backupKmqDatabase();
    });

    // every 5 minutes
    schedule.scheduleJob("*/5 * * * *", async () => {
        reloadAliases();
        updatePublishDateOverrides();
    });
}

/** Reloads caches */
export async function reloadCaches() {
    reloadAliases();
    reloadFactCache();
}

/** @returns a mapping of command name to command source file */
export function getCommandFiles(shouldReload: boolean): Promise<{ [commandName: string]: BaseCommand }> {
    if (cachedCommandFiles && !shouldReload) {
        return Promise.resolve(cachedCommandFiles);
    }

    return new Promise(async (resolve, reject) => {
        const commandMap = {};
        let files: Array<string>;
        try {
            files = await glob(process.env.NODE_ENV === EnvType.DEV ? "commands/**/*.ts" : "commands/**/*.js");
            await Promise.all(files.map(async (file) => {
                const commandFilePath = path.join("../", file);
                if (shouldReload) {
                    // invalidate require cache
                    delete require.cache[require.resolve(commandFilePath)];
                }
                try {
                    const command = require(commandFilePath);
                    const commandName = path.parse(file).name;
                    logger.info(`Registering command: ${commandName}`);
                    // eslint-disable-next-line new-cap
                    commandMap[commandName] = new command.default();
                } catch (e) {
                    throw new Error(`Failed to load file: ${commandFilePath}`);
                }
            }));
            cachedCommandFiles = commandMap;
            resolve(commandMap);
        } catch (err) {
            reject(err);
            logger.error(`Unable to read commands error = ${err}`);
        }
    });
}

/**
 * Registers a command
 * @param command - The Command class
 * @param commandName - The name/alias of the command
 */
function registerCommand(command: BaseCommand, commandName: string) {
    if (commandName in state.commands) {
        logger.error(`Command \`${commandName}\` already exists. Possible conflict?`);
    }
    state.commands[commandName] = command;
}

/** Registers commands */
export async function registerCommands(initialLoad: boolean) {
    // load commands
    state.commands = {};
    const commandFiles = await getCommandFiles(!initialLoad);
    for (const [commandName, command] of Object.entries(commandFiles)) {
        if (commandName === "base_command") continue;
        registerCommand(command, commandName);
        if (command.aliases) {
            for (const alias of command.aliases) {
                registerCommand(command, alias);
            }
        }
    }
}

/** Initialize server count posting to bot listing sites */
export function initializeBotStatsPoster() {
    state.botStatsPoster = new BotStatsPoster();
    state.botStatsPoster.start();
}

/**
 * Deletes the GameSession corresponding to a given guild ID
 * @param guildID - The guild ID
 */
export function deleteGameSession(guildID: string) {
    if (!(guildID in state.gameSessions)) {
        logger.debug(`gid: ${guildID} | GameSession already ended`);
        return;
    }
    delete state.gameSessions[guildID];
}

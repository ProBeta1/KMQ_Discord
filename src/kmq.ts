import * as Discord from "discord.js";
import * as Knex from "knex";
import * as cronParser from "cron-parser";
import * as _kmqKnexConfig from "../config/knexfile_kmq";
import * as _kpopVideosKnexConfig from "../config/knexfile_kpop_videos";
import { validateConfig } from "./config_validator";
import { guessSong, cleanupInactiveGameSessions, getGuildPreference } from "./helpers/game_utils";
import validate from "./helpers/validate";
import { getCommandFiles, EMBED_INFO_COLOR } from "./helpers/discord_utils";
import { ParsedMessage } from "types";
import * as _config from "../config/app_config.json";
import BaseCommand from "commands/base_command";
import GameSession from "models/game_session";
import BotStatsPoster from "./helpers/bot_stats_poster";
import _logger from "./logger";
import * as fs from "fs";
import { db } from "./databases";
const logger = _logger("kmq");

const client = new Discord.Client();

const config: any = _config;
const RESTART_WARNING_INTERVALS = new Set([10, 5, 2, 1]);

let commands: { [commandName: string]: BaseCommand } = {};
let gameSessions: { [guildID: string]: GameSession } = {};
let botStatsPoster: BotStatsPoster = null;

client.on("ready", () => {
    logger.info(`Logged in as ${client.user.tag}! in '${process.env.NODE_ENV}' mode`);
});

client.on("message", async (message: Discord.Message) => {
    if (message.author.equals(client.user) || message.author.bot) return;
    if (!message.guild){
        logger.info(`Received message in DMs: message = ${message.content}`);
        return;
    }
    if (!message.guild.available) {
        logger.error(`gid: ${message.guild.id} | Guild currently unavailable`);
        return;
    }
    const guildPreference = await getGuildPreference(message.guild.id);
    const botPrefix = guildPreference.getBotPrefix();
    const parsedMessage = parseMessage(message.content, botPrefix) || null;

    if (message.isMemberMentioned(client.user) && message.content.split(" ").length == 1) {
        // Any message that mentions the bot sends the current options
        commands["options"].call({ message });
    }
    if (parsedMessage && commands[parsedMessage.action]) {
        const command = commands[parsedMessage.action];
        if (validate(message, parsedMessage, command.validations, botPrefix)) {
            command.call({
                client,
                gameSessions,
                message,
                parsedMessage,
                botPrefix
            });
        }
    }
    else {
        if (gameSessions[message.guild.id] && gameSessions[message.guild.id].gameRound) {
            guessSong({ client, message, gameSessions });
            gameSessions[message.guild.id].lastActiveNow();
        }
    }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    const oldUserChannel = oldState.voiceChannel;
    if (!oldUserChannel) {
        return;
    }
    const newUserChannel = newState.voiceChannel;
    if (!newUserChannel) {
        const guildID = oldUserChannel.guild.id;
        const gameSession = gameSessions[guildID];
        // User left voice channel, check if bot is only one left
        if (oldUserChannel.members.size === 1 && oldUserChannel.members.has(client.user.id)) {
            const voiceConnection = client.voiceConnections.get(guildID);
            if (voiceConnection) {
                voiceConnection.disconnect();
                if (gameSession) {
                    logger.info(`gid: ${oldUserChannel.guild.id} | Bot is only user left, leaving voice...`)
                    await gameSessions[newState.guild.id].endSession(gameSessions);
                }
                return;
            }
        }
    }
});




const parseMessage = (message: string, botPrefix: string): ParsedMessage => {
    if (message.charAt(0) !== botPrefix) return null;
    const components = message.split(" ");
    const action = components.shift().substring(1);
    const argument = components.join(" ");
    return {
        action,
        argument,
        message,
        components
    }
}

const checkRestartNotification = async (restartNotification: Date): Promise<void> => {
    const timeDiffMin = Math.floor((restartNotification.getTime() - (new Date()).getTime()) / (1000 * 60));
    let channelsWarned = 0;
    if (RESTART_WARNING_INTERVALS.has(timeDiffMin)) {
        for (let guildId in gameSessions) {
            const gameSession = gameSessions[guildId];
            if (gameSession.finished) continue;
            await gameSession.textChannel.send({
                embed: {
                    color: EMBED_INFO_COLOR,
                    author: {
                        name: client.user.username,
                        icon_url: client.user.avatarURL
                    },
                    title: `Upcoming bot restart in ${timeDiffMin} minutes.`,
                    description: `Downtime will be approximately 2 minutes.`
                }
            })
            channelsWarned++;
        }
        logger.info(`Impending bot restart in ${timeDiffMin} minutes. ${channelsWarned} servers warned.`);
    }
}

(async () => {

    if (!validateConfig(config)) {
        logger.error("Invalid config, aborting.");
        process.exit(1);
    }

    //load commands
    const commandFiles = await getCommandFiles();
    for (const [commandName, command] of Object.entries(commandFiles)) {
        if (commandName === "base_command") continue;
        commands[commandName] = command;
        if (command.aliases) {
            command.aliases.forEach((alias) => {
                commands[alias] = command;
            });
        }
    }
    //populate group list
    const result = await db.kpopVideos("kpop_videos.app_kpop_group")
        .select(["name", "members as gender"])
        .orderBy("name", "ASC")
    fs.writeFileSync(config.groupListFile, result.map((x) => x["name"]).join("\n"));

    //set up bot stats poster
    botStatsPoster = new BotStatsPoster(client);
    botStatsPoster.start();

    //set up cleanup for inactive game sessions
    setInterval(() => {
        cleanupInactiveGameSessions(gameSessions);
    }, 10 * 60 * 1000)

    //set up check for restart notifications
    setInterval(async () => {
        //unscheduled restarts
        const restartNotification = (await db.kmq("restart_notifications").where("id", 1))[0]["restart_time"];
        if (restartNotification) {
            const restartNotificationTime = new Date(restartNotification);
            if (restartNotificationTime.getTime() > Date.now()) {
                await checkRestartNotification(restartNotificationTime);
                return;
            }
        }

        //cron based restart
        if (config.restartCron) {
            const interval = cronParser.parseExpression(config.restartCron);
            const nextRestartTime = interval.next();
            await checkRestartNotification(nextRestartTime.toDate());
        }
    }, 60 * 1000);
    client.login(config.botToken);
})();

process.on("unhandledRejection", (reason: Error, p: Promise<any>) => {
    logger.error(`Unhandled Rejection at: Promise ${p}. Reason: ${reason}. Trace: ${reason.stack}`);
});


process.on("uncaughtException", (err: Error) => {
    logger.error(`Uncaught Exception. Reason: ${err}. Trace: ${err.stack}`);
});

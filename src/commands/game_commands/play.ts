import GameSession from "../../structures/game_session";
import {
    sendErrorMessage, getDebugLogHeader, sendInfoMessage, voicePermissionsCheck, getVoiceChannelFromMessage,
} from "../../helpers/discord_utils";
import { deleteGameSession } from "../../helpers/management_utils";
import { getGuildPreference } from "../../helpers/game_utils";
import { bold, isPowerHour, isWeekend } from "../../helpers/utils";
import BaseCommand, { CommandArgs } from "../base_command";
import _logger from "../../logger";
import { GuildTextableMessage } from "../../types";
import { KmqImages } from "../../constants";
import MessageContext from "../../structures/message_context";
import KmqMember from "../../structures/kmq_member";

const logger = _logger("play");
const DEFAULT_LIVES = 10;

export enum GameType {
    CLASSIC = "classic",
    ELIMINATION = "elimination",
    TEAMS = "teams",
}

export async function sendBeginGameMessage(textChannelName: string, voiceChannelName: string, message: GuildTextableMessage) {
    let gameInstructions = "Listen to the song and type your guess!";
    if (isWeekend()) {
        gameInstructions += "\n\n**⬆️ DOUBLE EXP WEEKEND ACTIVE ⬆️**";
    } else if (isPowerHour()) {
        gameInstructions += "\n\n**⬆️ KMQ POWER HOUR ACTIVE ⬆️**";
    }
    const startTitle = `Game starting in #${textChannelName} in 🔊 ${voiceChannelName}`;
    await sendInfoMessage(MessageContext.fromMessage(message), { title: startTitle, description: gameInstructions, thumbnailUrl: KmqImages.HAPPY });
}

export default class PlayCommand implements BaseCommand {
    validations = {
        minArgCount: 0,
        maxArgCount: 2,
        arguments: [
            {
                name: "gameType",
                type: "enum" as const,
                enums: Object.values(GameType),
            },
            {
                name: "lives",
                type: "number" as const,
                minValue: 1,
                maxValue: 500,
            },
        ],
    };

    aliases = ["random", "start", "p"];

    help = {
        name: "play",
        description: "Starts a game of KMQ. Pick between classic (default) and elimination mode",
        usage: "!play",
        priority: 1050,
        examples: [
            {
                example: "`!play`",
                explanation: "Start a classic game of KMQ (type in your guess first to get a point)",
            },
            {
                example: "`!play elimination 5`",
                explanation: "Start an elimination game of KMQ where each player starts with `5` lives.",
            },
            {
                example: "`!play elimination`",
                explanation: `Start an elimination game of KMQ where each player starts with \`${DEFAULT_LIVES}\` lives.`,
            },
            {
                example: "`!play teams`",
                explanation: "Split up into as many teams as you want and see who you can depend on to help you win!",
            },
        ],
    };

    async call({ message, gameSessions, parsedMessage, channel }: CommandArgs) {
        const guildPreference = await getGuildPreference(message.guildID);
        const voiceChannel = getVoiceChannelFromMessage(message);
        if (!voiceChannel) {
            await sendErrorMessage(MessageContext.fromMessage(message),
                {
                    title: "Join a voice channel",
                    description: `Send \`${process.env.BOT_PREFIX}play\` again when you are in a voice channel.`,
                });
            logger.warn(`${getDebugLogHeader(message)} | User not in voice channel`);
        } else {
            if (!voicePermissionsCheck(message)) {
                return;
            }
            const isEliminationMode = parsedMessage.components.length >= 1 && parsedMessage.components[0].toLowerCase() === "elimination";
            const isTeamsMode = parsedMessage.components.length >= 1 && parsedMessage.components[0].toLowerCase() === "teams";
            if (gameSessions[message.guildID] && !gameSessions[message.guildID].sessionInitialized && (isEliminationMode || isTeamsMode)) {
                // User sent ,play elimination or ,play teams twice, reset the GameSession
                deleteGameSession(message.guildID);
            }
            if (!gameSessions[message.guildID] || (!isEliminationMode && !gameSessions[message.guildID].sessionInitialized)) {
                // (1) No game session exists yet (create CLASSIC, ELIMINATION, or TEAMS game), or
                // (2) User attempting to ,play after a ,play elimination/teams that didn't start, start CLASSIC game
                const textChannel = channel;
                let startTitle: string;
                let gameInstructions: string;
                let gameSession: GameSession;

                const gameOwner = KmqMember.fromUser(message.author);
                if (isEliminationMode) {
                    // (1) ELIMINATION game creation
                    const lives = parsedMessage.components.length > 1 ? parseInt(parsedMessage.components[1], 10) : DEFAULT_LIVES;
                    startTitle = `\`${process.env.BOT_PREFIX}join\` the game and start it with \`${process.env.BOT_PREFIX}begin\`!`;
                    gameInstructions = `Type \`${process.env.BOT_PREFIX}join\` to play in the upcoming elimination game. Once all have joined, ${bold(gameOwner.tag)} must send \`${process.env.BOT_PREFIX}begin\` to start the game. Everyone begins with \`${lives}\` lives.`;
                    gameSession = new GameSession(textChannel.id, voiceChannel.id, textChannel.guild.id, gameOwner, GameType.ELIMINATION, lives);
                    gameSession.addEliminationParticipant(gameOwner);
                    await sendInfoMessage(MessageContext.fromMessage(message), { title: startTitle, description: gameInstructions, thumbnailUrl: KmqImages.HAPPY });
                } else if (isTeamsMode) {
                    // (1) TEAMS game creation
                    startTitle = `\`${process.env.BOT_PREFIX}join\` a team!`;
                    gameInstructions = `Type \`${process.env.BOT_PREFIX}join [team name]\` to form a new team. Remember, switching teams mid-game will forfeit all your current score and EXP.`;
                    await sendInfoMessage(MessageContext.fromMessage(message), { title: startTitle, description: gameInstructions, thumbnailUrl: KmqImages.HAPPY });
                    gameSession = new GameSession(textChannel.id, voiceChannel.id, textChannel.guild.id, gameOwner, GameType.TEAMS);
                } else {
                    // (1 and 2) CLASSIC game creation
                    gameSession = new GameSession(textChannel.id, voiceChannel.id, textChannel.guild.id, gameOwner, GameType.CLASSIC);
                    await sendBeginGameMessage(textChannel.name, voiceChannel.name, message);
                    gameSession.startRound(guildPreference, MessageContext.fromMessage(message));
                    logger.info(`${getDebugLogHeader(message)} | Game session starting`);
                }
                gameSessions[message.guildID] = gameSession;
            } else {
                await sendErrorMessage(MessageContext.fromMessage(message), { title: "Game already in session" });
            }
        }
    }
}

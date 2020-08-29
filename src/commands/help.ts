import BaseCommand, { CommandArgs } from "./base_command";
import * as Eris from "eris";
import * as helpMessages from "../../data/help_strings.json";
import { EMBED_INFO_COLOR, sendErrorMessage, getDebugContext, sendPaginationedEmbed, sendEmbed } from "../helpers/discord_utils";
import _logger from "../logger";
import { chunkArray } from "../helpers/utils";
import { getCommandFiles } from "../helpers/management_utils";
const logger = _logger("help");
const placeholder = /!/g;
const FIELDS_PER_EMBED = 5;
export default class HelpCommand implements BaseCommand {
    async call({ parsedMessage, message, botPrefix }: CommandArgs) {
        await helpMessage(message, parsedMessage.argument, botPrefix);
    }
    help =
        {
            name: "help",
            description: "Get help about the game's commands. Add the command as an argument to get information about the specific command.",
            usage: "!help [command]",
            examples: [
                {
                    example: "`!help`",
                    explanation: "Shows all available commands and a short description"
                },
                {
                    example: "`!help cutoff`",
                    explanation: "Shows a detailed description for the cutoff command"
                }
            ]
        }
}

// Usage: `!help [action]` or `!help`
const helpMessage = async (message: Eris.Message<Eris.GuildTextableChannel>, action: string, botPrefix: string) => {
    let embedTitle = "";
    let embedDesc = "";
    let embedFields = [];
    //TODO: potentially do some caching?
    const commandFiles = await getCommandFiles();
    let commandFilesWithAliases: { [commandName: string]: BaseCommand } = {};
    Object.assign(commandFilesWithAliases, commandFiles);
    const commandNamesWithAliases = Object.keys(commandFiles).filter((commandName) => commandFiles[commandName].aliases);
    for (let commandName of commandNamesWithAliases) {
        const aliases = commandFiles[commandName].aliases;
        aliases.forEach(alias => {
            commandFilesWithAliases[alias] = commandFiles[commandName];
        });
    }

    let embedFooter = null;
    if (action) {
        const commandNamesWithHelp = Object.keys(commandFilesWithAliases).filter((commandName) => commandFilesWithAliases[commandName].help);
        if (!(commandNamesWithHelp.includes(action))) {
            logger.warn(`${getDebugContext(message)} | Missing documentation: ${action}`);
            await sendErrorMessage(message,
                "K-pop Music Quiz Command Help",
                `Sorry, there is no documentation on ${action}`)
            return;
        }
        const helpManual = commandFilesWithAliases[action].help;
        embedTitle = `\`${helpManual.usage.replace(placeholder, botPrefix)}\``;
        embedDesc = helpManual.description;
        if (helpManual.examples.length > 0) {
            embedDesc += `\n\n**Examples**\n`;
        }
        helpManual.examples.forEach((example) => {
            embedFields.push({
                name: example.example.replace(placeholder, botPrefix),
                value: example.explanation
            })
        });
        if (commandFilesWithAliases[action].aliases) {
            embedFooter = {
                text: `Aliases: ${commandFilesWithAliases[action].aliases.join(", ")}`
            }
        }

    }
    else {
        const commandNamesWithHelp = Object.keys(commandFiles).filter((commandName) => commandFiles[commandName].help);
        embedTitle = "K-pop Music Quiz Command Help";
        embedDesc = helpMessages.rules.replace(placeholder, botPrefix);
        commandNamesWithHelp.forEach((commandName) => {
            const helpManual = commandFiles[commandName].help;
            embedFields.push({
                name: helpManual.name,
                value: `${helpManual.description}\nUsage: \`${helpManual.usage.replace(placeholder, botPrefix)}\``
            })
        });

    }

    if (embedFields.length > 0) {
        const embedFieldSubsets = chunkArray(embedFields, FIELDS_PER_EMBED);
        const embeds = embedFieldSubsets.map(embedFieldsSubset => ({
            title: embedTitle,
            color: EMBED_INFO_COLOR,
            description: embedDesc,
            fields: embedFieldsSubset,
            footer: embedFooter
        }));

        await sendPaginationedEmbed(message, embeds);
    }
    else {
        await sendEmbed(message, {
            title: embedTitle,
            color: EMBED_INFO_COLOR,
            description: embedDesc,
            footer: embedFooter
        })
    }
}

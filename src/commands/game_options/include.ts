import BaseCommand, { CommandArgs } from "../base_command";
import { sendOptionsMessage, getDebugLogHeader, sendErrorMessage, getMessageContext } from "../../helpers/discord_utils";
import { getGuildPreference, getMatchingGroupNames } from "../../helpers/game_utils";
import _logger from "../../logger";
import { GameOption } from "../../types";

const logger = _logger("includes");

export default class IncludeCommand implements BaseCommand {
    help = {
        name: "include",
        description: "Select as many groups that you would like to forcefully include, ignoring other filters (`gender`, `artisttype`, etc), separated by commas. A list of group names can be found [here](https://raw.githubusercontent.com/Brainicism/KMQ_Discord/master/data/group_list.txt)",
        usage: "!include [group1],{group2}",
        examples: [
            {
                example: "`!include blackpink`",
                explanation: "Forcefully include songs from Blackpink",
            },
            {
                example: "`!include blackpink, bts, red velvet`",
                explanation: "Forcefully include songs from Blackpink, BTS, and Red Velvet",
            },
            {
                example: "`!include`",
                explanation: "Resets the include option",
            },
        ],
        priority: 130,
    };

    aliases = ["include", "includes", "add"];

    async call({ message, parsedMessage }: CommandArgs) {
        const guildPreference = await getGuildPreference(message.guildID);
        if (parsedMessage.components.length === 0) {
            guildPreference.resetIncludes();
            logger.info(`${getDebugLogHeader(message)} | Includes reset.`);
            await sendOptionsMessage(message, guildPreference, { option: GameOption.INCLUDE, reset: true });
            return;
        }
        if (guildPreference.isGroupsMode()) {
            logger.warn(`${getDebugLogHeader(message)} | Game option conflict between include and groups.`);
            sendErrorMessage(getMessageContext(message), "Game Option Conflict", `\`groups\` game option is currently set. \`include\` and \`groups\` are incompatible. Remove the \`groups\` option by typing \`${process.env.BOT_PREFIX}groups\` to proceed`);
            return;
        }

        const groupNames = parsedMessage.argument.split(",").map((groupName) => groupName.trim());
        const { matchedGroups, unmatchedGroups } = await getMatchingGroupNames(groupNames);
        if (unmatchedGroups) {
            logger.info(`${getDebugLogHeader(message)} | Attempted to set unknown includes. includes =  ${unmatchedGroups.join(", ")}`);
            await sendErrorMessage(getMessageContext(message), "Unknown Group Name", `One or more of the specified group names was not recognized. Please ensure that the group name matches exactly with the list provided by \`${process.env.BOT_PREFIX}help groups\` \nThe following groups were **not** recognized:\n ${unmatchedGroups.join(", ")} `);
            return;
        }

        guildPreference.setIncludes(matchedGroups);
        await sendOptionsMessage(message, guildPreference, { option: GameOption.INCLUDE, reset: false });
        logger.info(`${getDebugLogHeader(message)} | Includes set to ${guildPreference.getDisplayedIncludesGroupNames()}`);
    }
}

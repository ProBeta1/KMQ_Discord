const { EMBED_INFO_COLOR, getDebugContext, sendOptionsMessage, getSongCount, GameOptions } = require("../helpers/utils.js");
const DEFAULT_LIMIT = 500;
const logger = require("../logger")("limit");

module.exports = {
    call: async ({ message, parsedMessage, guildPreference, db }) => {
        guildPreference.setLimit(parseInt(parsedMessage.components[0]), db);
        let songCount = await getSongCount(guildPreference, db);
        if (guildPreference.getLimit() > songCount) {
            guildPreference.setLimit(songCount, db);
        }
        sendOptionsMessage(message, guildPreference, db, GameOptions.LIMIT);
        logger.info(`${getDebugContext(message)} | Limit set to ${guildPreference.getLimit()}`);
    },
    validations: {
        minArgCount: 1,
        maxArgCount: 1,
        arguments: [
            {
                name: 'limit',
                type: 'number',
                minValue: 1,
                maxValue: 10000
            }
        ]
    },
    DEFAULT_LIMIT
}

import _logger from "../../logger";
import state from "../../kmq";
import dbContext from "../../database_context";
import { endSession } from "../../helpers/game_utils";

const logger = _logger("SIGINT");

export default async function SIGINTHandler() {
    logger.debug("SIGINT received, cleaning up...");
    for (const guildID of Object.keys(state.gameSessions)) {
        const gameSession = state.gameSessions[guildID];
        logger.debug(`gid: ${guildID} | Forcing game session end`);
        await endSession(gameSession);
    }
    await dbContext.destroy();
    process.exit(0);
}

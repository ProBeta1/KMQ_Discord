import Axios from "axios";
import _logger from "../logger";
import state from "../kmq";

const logger = _logger("bot_stats_poster");

interface BotListing {
    endpoint: string;
    payloadKeyName: string;
    name: string;
}

const BOT_LISTING_SITES: { [siteName: string]: BotListing } = {
    TOP_GG_TOKEN: {
        endpoint: "https://top.gg/api/bots/%d/stats",
        payloadKeyName: "server_count",
        name: "top.gg",
    },
    DISCORD_BOTS_GG_TOKEN: {
        endpoint: "https://discord.bots.gg/api/v1/bots/%d/stats",
        payloadKeyName: "guildCount",
        name: "discord.bots.gg",
    },
    DISCORD_BOT_LIST_TOKEN: {
        endpoint: "https://discordbotlist.com/api/v1/bots/%d/stats",
        payloadKeyName: "guilds",
        name: "discordbotlist.com",
    },
};
export default class BotStatsPoster {
    start() {
        setInterval(() => { this.postStats(); }, 1800000);
    }

    private async postStats() {
        for (const siteConfigKeyName of Object.keys(BOT_LISTING_SITES).filter((x) => x in process.env)) {
            this.postStat(siteConfigKeyName);
        }
    }

    // eslint-disable-next-line class-methods-use-this
    private async postStat(siteConfigKeyName: string) {
        const botListing = BOT_LISTING_SITES[siteConfigKeyName];
        const { client } = state;
        try {
            await Axios.post(botListing.endpoint.replace("%d", client.user.id), {
                [botListing.payloadKeyName]: client.guilds.size,
            }, {
                headers: {
                    Authorization: process.env[siteConfigKeyName],
                },
            });
            logger.info(`${botListing.name} server count posted`);
        } catch (e) {
            logger.error(`Error updating ${botListing.name} server count. error = ${e}`);
        }
    }
}

import Player from "./player";
import { roundDecimal } from "../helpers/utils";
import _logger from "../logger";
import GuildPreference from "./guild_preference";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = _logger("scoreboard");

export default class Scoreboard {
    /** Mapping of Discord user ID to Player */
    protected players: { [userID: string]: Player };

    /** The current players in first place */
    protected firstPlace: Array<Player>;

    /** The current highest score */
    protected highestScore: number;

    constructor() {
        this.players = {};
        this.firstPlace = [];
        this.highestScore = 0;
    }

    /** @returns a string congratulating the winner(s) */
    getWinnerMessage(): string {
        let winnerStr = "";

        if (this.firstPlace.length === 1) {
            return `${this.firstPlace[0].getName()} wins!`;
        }

        for (let i = 0; i < this.firstPlace.length; i++) {
            winnerStr += this.firstPlace[i].getName();
            if (i === this.firstPlace.length - 1) {
                // Last entry -- append just the username
                winnerStr += " ";
            } else if (i === this.firstPlace.length - 2) {
                // Second last entry -- use "and"
                winnerStr += " and ";
            } else {
                // At least two more entries -- separate by ","
                winnerStr += ", ";
            }
        }
        winnerStr += "win!";
        return winnerStr;
    }

    /** @returns An array of DiscordEmbed fields representing each participant's score */
    getScoreboardEmbedFields(): Array<{ name: string, value: string, inline: boolean }> {
        return Object.values(this.players)
            .sort((a, b) => b.getScore() - a.getScore())
            .map((x) => (
                {
                    name: x.getName(),
                    value: Number.isInteger(roundDecimal(x.getScore(), 1)) ? roundDecimal(x.getScore(), 1).toString() : x.getScore().toFixed(1),
                    inline: true,
                }));
    }

    /**
     * @param winnerTag - The Discord tag of the correct guesser
     * @param winnerID  - The Discord ID of the correct guesser
     * @param avatarURL - The avatar URL of the correct guesser
     * @param pointsEarned - The amount of points awarded
     * @param expGain - The amount of EXP gained
     */
    updateScoreboard(winnerTag: string, winnerID: string, avatarURL: string, pointsEarned: number, expGain: number) {
        if (!this.players[winnerID]) {
            this.players[winnerID] = new Player(winnerTag, winnerID, avatarURL, pointsEarned);
        } else {
            this.players[winnerID].incrementScore(pointsEarned);
        }
        this.players[winnerID].incrementExp(expGain);
        const winnerScore = this.players[winnerID].getScore();

        if (winnerScore === this.highestScore) {
            // If user is tied for first, add them to the first place array
            this.firstPlace.push(this.players[winnerID]);
        } else if (winnerScore > this.highestScore) {
            // If user is first, reset first place array and add them
            this.highestScore = winnerScore;
            this.firstPlace = [this.players[winnerID]];
        }
    }

    /**
     * @returns whether the scoreboard has any players on it
     * (if there are none in first place, then the scoreboard must be empty)
     */
    isEmpty(): boolean {
        return this.firstPlace.length === 0;
    }

    /** @returns a list of the player currently in first place */
    getWinners(): Array<Player> {
        return this.firstPlace;
    }

    /**
     * @param userId - The Discord user ID of the player to check
     * @returns the score of the player
     */
    getPlayerScore(userId: string): number {
        if (userId in this.players) {
            return this.players[userId].getScore();
        }
        return 0;
    }

    /**
     * @param userId - The Discord user ID of the player to check
     * @returns the exp gained by the player
     */
    getPlayerExpGain(userId: string): number {
        if (userId in this.players) {
            return this.players[userId].getExpGain();
        }
        return 0;
    }

    /**
     * @param guildPreference - The GuildPreference
     * @returns whether the game has completed
     * */
    gameFinished(guildPreference: GuildPreference): boolean {
        return guildPreference.isGoalSet() && !this.isEmpty() && this.firstPlace[0].getScore() >= guildPreference.getGoal();
    }

    /** @returns a list of tags of the player participating in the game */
    getPlayerNames(): Array<string> {
        return Object.values(this.players).map((player) => player.getName());
    }

    /**
     *  @param userId - The Discord user ID of the Player
     *  @returns a Player object for the corresponding user ID
     * */
    getPlayerName(userId: string): string {
        return this.players[userId].getName();
    }
}

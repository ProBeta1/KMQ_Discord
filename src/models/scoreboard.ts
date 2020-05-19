import Player from "./player";

export default class Scoreboard {
    private players: { [userID: number]: Player }
    private firstPlace: Array<Player>;
    private highestScore: number;
    constructor() {
        this.players = {};
        this.firstPlace = [];
        this.highestScore = 0;
    }

    getWinnerMessage(): string {
        let winnerStr = "";

        if (this.firstPlace.length == 1) {
            return this.firstPlace[0].getName() + " wins!";
        }

        for (let i = 0; i < this.firstPlace.length; i++) {
            winnerStr += this.firstPlace[i].getName();
            if (i === this.firstPlace.length - 1) {
                // Last entry -- append just the username
                winnerStr += " ";
            }
            else if (i === this.firstPlace.length - 2) {
                // Second last entry -- use "and"
                winnerStr += " and ";
            }
            else {
                // At least two more entries -- separate by ","
                winnerStr += ", ";
            }
        }
        winnerStr += "win!";
        return winnerStr;
    }

    getScoreboard(): Array<{ name: string, value: number, inline: boolean }> {
        return Object.values(this.players).map((x) => {
            return { name: x.getName(), value: x.getScore(), inline: true }
        })
            .sort((a, b) => { return b.value - a.value; })
    }

    updateScoreboard(winnerTag: string, winnerID: string) {
        if (!this.players[winnerID]) {
            this.players[winnerID] = new Player(winnerTag);
        }
        else {
            this.players[winnerID].incrementScore();
        }

        if (this.players[winnerID].getScore() == this.highestScore) {
            // If user is tied for first, add them to the first place array
            this.firstPlace.push(this.players[winnerID]);
        }
        else if (this.players[winnerID].getScore() > this.highestScore) {
            // If user is first, reset first place array and add them
            this.highestScore = this.players[winnerID].getScore();
            this.firstPlace = [this.players[winnerID]];
        }
    }

    isEmpty(): boolean {
        return !(Object.keys(this.players).length);
    }
};

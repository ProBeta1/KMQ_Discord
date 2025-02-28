import crypto from "crypto";
import assert from "assert";
import { describe } from "mocha";
import sinon from "sinon";
import dbContext from "../../database_context";
import { md5Hash } from "../../helpers/utils";
import GuildPreference from "../../structures/guild_preference";
import { Gender } from "../../commands/game_options/gender";
import { cleanupInactiveGameSessions, getFilteredSongList, getMatchingGroupNames, getSongCount } from "../../helpers/game_utils";
import { EnvType } from "../../types";
import _logger from "../../logger";
import { ArtistType } from "../../commands/game_options/artisttype";
import { SubunitsPreference } from "../../commands/game_options/subunits";
import { FOREIGN_LANGUAGE_TAGS, LanguageType } from "../../commands/game_options/language";
import state from "../../kmq";
import GameSession from "../../structures/game_session";
import { OstPreference } from "../../commands/game_options/ost";
import { NON_OFFICIAL_VIDEO_TAGS, ReleaseType } from "../../commands/game_options/release";

const logger = _logger("test");

async function setup() {
    await dbContext.kmq.raw("DROP TABLE IF EXISTS available_songs");
    await dbContext.kmq.raw("DROP TABLE IF EXISTS kpop_groups");
    await dbContext.kmq.raw(`CREATE TABLE available_songs (
        song_name VARCHAR(255),
        link VARCHAR(255),
        artist_name VARCHAR(255),
        members ENUM('male', 'female', 'coed'),
        views BIGINT(19),
        id_artist INT(10),
        issolo ENUM('y', 'n'),
        publishedon DATE,
        id_parent_artist INT(10),
        vtype ENUM('main'),
        tags VARCHAR(255)
    )`);
    await dbContext.kmq.raw(`CREATE TABLE kpop_groups(
        id INT(10),
        name VARCHAR(255),
        members ENUM('male', 'female', 'coed'),
        issolo ENUM('y', 'n'),
        id_parentgroup INT(10),
        id_artist1 INT(10),
        id_artist2 INT(10),
        id_artist3 INT(10),
        id_artist4 INT(10)
    )`);
}

const mockArtists = [
    { id: 1, name: "A", members: "male", issolo: "n" },
    { id: 2, name: "B", members: "male", issolo: "n" },
    { id: 3, name: "C", members: "male", issolo: "n" },
    { id: 4, name: "D", members: "male", issolo: "y" },
    { id: 5, name: "E", members: "female", issolo: "n" },
    { id: 6, name: "F", members: "female", issolo: "n", id_parentgroup: 5 },
    { id: 7, name: "G", members: "female", issolo: "n" },
    { id: 8, name: "H", members: "female", issolo: "y" },
    { id: 9, name: "I", members: "female", issolo: "y", id_parentgroup: 8 },
    { id: 10, name: "J", members: "coed", issolo: "n" },
    { id: 11, name: "K", members: "coed", issolo: "n" },
    { id: 12, name: "J + K", members: "coed", issolo: "n", id_artist1: 10, id_artist2: 11 },
    { id: 13, name: "F + G", members: "female", issolo: "n", id_artist1: 6, id_artist2: 7 },
    { id: 14, name: "E + H", members: "female", issolo: "n", id_artist1: 5, id_artist2: 8 },
];

const mockSongs = [...Array(1000).keys()].map((i) => {
    const artist = mockArtists[md5Hash(i, 8) % mockArtists.length];
    return {
        song_name: `${crypto.randomBytes(8).toString("hex")}`,
        link: crypto.randomBytes(4).toString("hex"),
        artist_name: artist.name,
        members: artist.members,
        views: md5Hash(i, 16),
        id_artist: artist.id,
        issolo: artist.issolo,
        publishedon: new Date(`${["2008", "2009", "2016", "2017", "2018"][md5Hash(i, 8) % 5]}-06-01`),
        id_parent_artist: artist.id_parentgroup || 0,
        vtype: "main",
        tags: ["", "", "o", "c", "e", "drv", "ax", "ps"][md5Hash(i, 8) % 8],
    };
});
async function getMockGuildPreference(): Promise<GuildPreference> {
    const guildPreference = new GuildPreference("test");
    sinon.stub(guildPreference, "updateGuildPreferences");
    await guildPreference.setSubunitPreference(SubunitsPreference.EXCLUDE);
    await guildPreference.setLimit(0, 99999);
    await guildPreference.setOstPreference(OstPreference.INCLUDE);
    await guildPreference.setReleaseType(ReleaseType.ALL);
    return guildPreference;
}

async function insertMockData(): Promise<void> {
    await dbContext.kmq("available_songs").insert(mockSongs);

    logger.info("Done inserting mock songs");
    await dbContext.kmq("kpop_groups").insert(mockArtists);

    logger.info("Done inserting mock artists");
}

describe("song query", () => {
    before(async function () {
        if (process.env.NODE_ENV !== EnvType.TEST) {
            logger.error("Must be running with NODE_ENV=EnvType.TEST");
            process.exit(1);
        }
        this.timeout(10000);
        logger.info("Setting up test database...");
        await setup();
        await insertMockData();
    });

    let guildPreference: GuildPreference;
    beforeEach(async () => {
        guildPreference = await getMockGuildPreference();
    });

    describe("getFilteredSongList", () => {
        describe("gender game option", () => {
            const expectedSongCounts = {
                [Gender.MALE]: mockSongs.filter((song) => song.members === "male").length,
                [Gender.FEMALE]: mockSongs.filter((song) => song.members === "female").length,
                [Gender.COED]: mockSongs.filter((song) => song.members === "coed").length,
            };

            describe("single-select gender", () => {
                it("should match the expected song count", async () => {
                    for (const gender of [Gender.MALE, Gender.FEMALE, Gender.COED]) {
                        await guildPreference.setGender([gender]);
                        const { songs } = await getFilteredSongList(guildPreference);
                        assert.strictEqual(songs.length, expectedSongCounts[gender], `Gender query (${gender}) does not match with actual gender count`);
                    }
                });
            });

            describe("multi-select gender", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setGender([Gender.MALE, Gender.FEMALE]);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCounts[Gender.MALE] + expectedSongCounts[Gender.FEMALE]);
                });
            });
        });

        describe("gender override", () => {
            beforeEach(async () => {
                await guildPreference.setGender([Gender.ALTERNATING]);
            });

            describe("override to female", () => {
                it("should match the expected song count", async () => {
                    const { songs: femaleSongs } = await getFilteredSongList(guildPreference, null, Gender.FEMALE);
                    assert.ok(femaleSongs.every((song) => song.members === Gender.FEMALE));
                });
            });
            describe("override to male", () => {
                it("should match the expected song count", async () => {
                    const { songs: maleSongs } = await getFilteredSongList(guildPreference, null, Gender.MALE);
                    assert.ok(maleSongs.every((song) => song.members === Gender.MALE));
                });
            });
        });

        describe("ignored songs", () => {
            describe("ignoring first 10 songs", () => {
                it("should match the expected song count", async () => {
                    const numIgnored = 10;
                    const ignoredSongs = new Set(mockSongs.slice(0, numIgnored).map((song) => song.link));
                    const { songs } = await getFilteredSongList(guildPreference, ignoredSongs);
                    assert.ok(songs.length === mockSongs.length - numIgnored);
                    assert.ok(songs.filter((song) => ignoredSongs.has(song.youtubeLink)).length === 0);
                });
            });
        });

        describe("groups", () => {
            const expectedSongCounts = mockArtists.reduce((map, obj) => {
                map[obj.id] = mockSongs.filter((song) => song.id_artist === obj.id).length;
                return map;
            }, {});

            beforeEach(async () => {
                await guildPreference.setGender([Gender.ALTERNATING]);
            });

            describe("single-selected group", () => {
                it("should match the expected song count", async () => {
                    for (const artist of mockArtists) {
                        await guildPreference.setGroups([{ id: artist.id, name: artist.name }]);
                        const { songs } = await getFilteredSongList(guildPreference);
                        assert.strictEqual(songs.length, expectedSongCounts[artist.id]);
                    }
                });
            });
            describe("multi-selected groups", () => {
                it("should match the expected song count", async () => {
                    const mockArtistSubset = mockArtists.slice(0, 5);
                    await guildPreference.setGroups(mockArtistSubset.map((artist) => ({ id: artist.id, name: artist.name })));
                    const { songs } = await getFilteredSongList(guildPreference);
                    const expectedMultiSongCount = mockArtistSubset.reduce((sum, artist) => sum + expectedSongCounts[artist.id], 0);
                    assert.strictEqual(songs.length, expectedMultiSongCount);
                });
            });
        });

        describe("includes", () => {
            const expectedFemaleCount = mockSongs.filter((song) => song.members === Gender.FEMALE).length;
            const includedArtists = mockArtists.filter((artist) => artist.members === Gender.MALE).slice(0, 2);
            const expectedIncludeCount = mockSongs.filter((song) => includedArtists.map((artist) => artist.id).includes(song.id_artist)).length;

            describe("female gender, include 2 male groups", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setGender([Gender.FEMALE]);
                    await guildPreference.setIncludes(includedArtists.map((artist) => ({ id: artist.id, name: artist.name })));
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedFemaleCount + expectedIncludeCount);
                });
            });
        });

        describe("excludes", () => {
            const expectedFemaleCount = mockSongs.filter((song) => song.members === Gender.FEMALE).length;
            const excludeArtists = mockArtists.filter((artist) => artist.members === Gender.FEMALE).slice(0, 2);
            const expectedExcludeCount = mockSongs.filter((song) => excludeArtists.map((artist) => artist.id).includes(song.id_artist)).length;

            describe("female gender, exclude 2 female groups", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setGender([Gender.FEMALE]);
                    await guildPreference.setExcludes(excludeArtists.map((artist) => ({ id: artist.id, name: artist.name })));
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedFemaleCount - expectedExcludeCount);
                });
            });
        });

        describe("artist type", () => {
            const expectedSoloistCount = mockSongs.filter((song) => song.issolo === "y").length;
            const expectedGroupsCount = mockSongs.filter((song) => song.issolo === "n").length;

            describe("soloists", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setArtistType(ArtistType.SOLOIST);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSoloistCount);
                });
            });

            describe("groups", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setArtistType(ArtistType.GROUP);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedGroupsCount);
                });
            });
        });

        describe("cutoff", () => {
            describe("songs in or after 2016", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => song.publishedon >= new Date("2016-01-01")).length;
                    await guildPreference.setBeginningCutoffYear(2016);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("songs in or before 2015", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => song.publishedon <= new Date("2015-12-31")).length;
                    await guildPreference.setEndCutoffYear(2015);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("songs between 2008 and 2018", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => song.publishedon >= new Date("2008-01-01") && song.publishedon <= new Date("2018-12-31")).length;
                    await guildPreference.setBeginningCutoffYear(2008);
                    await guildPreference.setEndCutoffYear(2018);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("songs in 2017", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => song.publishedon >= new Date("2017-01-01") && song.publishedon <= new Date("2017-12-31")).length;
                    await guildPreference.setBeginningCutoffYear(2017);
                    await guildPreference.setEndCutoffYear(2017);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });
        });

        describe("subunits", () => {
            const artistWithSubunit = mockArtists[7];
            const subunitArtist = mockArtists[8];

            describe("exclude subunits", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setGroups([{ id: artistWithSubunit.id, name: artistWithSubunit.name }]);
                    const expectedSongCount = mockSongs.filter((song) => song.id_artist === artistWithSubunit.id).length;
                    await guildPreference.setSubunitPreference(SubunitsPreference.EXCLUDE);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("include subunits", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setGroups([{ id: artistWithSubunit.id, name: artistWithSubunit.name }]);
                    const expectedSongCount = mockSongs.filter((song) => song.id_artist === artistWithSubunit.id || song.id_artist === subunitArtist.id).length;
                    await guildPreference.setSubunitPreference(SubunitsPreference.INCLUDE);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });
            describe("include subunits (and the subunit has a collab)", () => {
                it("should match the songs from the group, collabs of that group, and collabs of any subunits of that group", async () => {
                    // E is a group with the subunit F. F is in a collab with G. E has a collab with H.
                    // E
                    const artistWithCollabingSubunit = mockArtists[4];
                    // F
                    const subunitWithCollab = mockArtists[5];
                    // F + G
                    const subunitCollabArtist = mockArtists[12];
                    // E + H
                    const parentCollabArtist = mockArtists[13];

                    const { matchedGroups, unmatchedGroups } = await getMatchingGroupNames([artistWithCollabingSubunit.name]);
                    await guildPreference.setGroups(matchedGroups);
                    await guildPreference.setSubunitPreference(SubunitsPreference.INCLUDE);
                    const expectedSongs = mockSongs.filter((song) => [artistWithCollabingSubunit.id, subunitWithCollab.id, subunitCollabArtist.id, parentCollabArtist.id].includes(song.id_artist));
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(unmatchedGroups.length, 0);
                    assert.deepStrictEqual(songs.map((x) => x.youtubeLink).sort(), expectedSongs.map((x) => x.link).sort());
                });
            });
        });

        describe("OSTs", () => {
            describe("exclude OSTs", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => !song.tags.includes("o")).length;
                    await guildPreference.setOstPreference(OstPreference.EXCLUDE);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("include OSTs", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.length;
                    await guildPreference.setOstPreference(OstPreference.INCLUDE);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("exclusive OSTs", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => song.tags.includes("o")).length;
                    await guildPreference.setOstPreference(OstPreference.EXCLUSIVE);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });
        });

        describe("limit", () => {
            const limit = 17;
            beforeEach(async () => {
                await guildPreference.setGender([Gender.COED]);
            });

            describe("with limit", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = limit;
                    await guildPreference.setLimit(0, limit);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });

            describe("without limit", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => song.members === Gender.COED).length;
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });
        });

        describe("language", () => {
            describe("language is set to korean only", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => !FOREIGN_LANGUAGE_TAGS.some((tag) => song.tags.includes(tag))).length;
                    await guildPreference.setLanguageType(LanguageType.KOREAN);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });
            describe("language is set to all", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setLanguageType(LanguageType.ALL);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, mockSongs.length);
                });
            });
        });

        describe("release type", () => {
            describe("release type is set to official only", () => {
                it("should match the expected song count", async () => {
                    const expectedSongCount = mockSongs.filter((song) => !NON_OFFICIAL_VIDEO_TAGS.some((tag) => song.tags.includes(tag))).length;
                    await guildPreference.setReleaseType(ReleaseType.OFFICIAL);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, expectedSongCount);
                });
            });
            describe("release type is set to all", () => {
                it("should match the expected song count", async () => {
                    await guildPreference.setReleaseType(ReleaseType.ALL);
                    const { songs } = await getFilteredSongList(guildPreference);
                    assert.strictEqual(songs.length, mockSongs.length);
                });
            });
        });
    });

    describe("getMatchingGroupNames", () => {
        describe("collabs", () => {
            it("should return the group and any collabs they are a part of in matchedGroups", async () => {
                const matchResults = await getMatchingGroupNames(["J"]);
                assert.deepStrictEqual(matchResults.matchedGroups.map((x) => x.name), ["J", "J + K"]);
                assert.strictEqual(matchResults.unmatchedGroups.length, 0);
            });
        });
        describe("fully matching group names", () => {
            it("should return the corresponding groups in matchedGroups", async () => {
                const matchResults = await getMatchingGroupNames(["A", "B", "c"]);
                assert.deepStrictEqual(matchResults.matchedGroups.map((x) => x.name), ["A", "B", "C"]);
                assert.strictEqual(matchResults.unmatchedGroups.length, 0);
            });
        });
        describe("some names in matchedGroups", () => {
            it("should return corresponding groups in unmatchedGroups/matchedGroups", async () => {
                const matchResults = await getMatchingGroupNames(["A", "B", "LinusTechTips", "Rihanna"]);
                assert.deepStrictEqual(matchResults.matchedGroups.map((x) => x.name), ["A", "B"]);
                assert.deepStrictEqual(matchResults.unmatchedGroups, ["LinusTechTips", "Rihanna"]);
            });
        });
        describe("no matching group names", () => {
            it("should return the groups in unmatchedGroups", async () => {
                const matchResults = await getMatchingGroupNames(["LinusTechTips", "Rihanna"]);
                assert.deepStrictEqual(matchResults.matchedGroups.length, 0);
                assert.deepStrictEqual(matchResults.unmatchedGroups, ["LinusTechTips", "Rihanna"]);
            });
        });
    });

    describe("getSongCount", () => {
        it("should return the expected song count", async () => {
            const limit = 50;
            await guildPreference.setLimit(0, limit);
            const songCount = await getSongCount(guildPreference);
            assert.strictEqual(songCount.count, limit);
            assert.strictEqual(songCount.countBeforeLimit, mockSongs.length);
        });
    });

    describe("cleanupInactiveGameSessions", () => {
        const guildId = "123";
        const gameSession = new GameSession(null, null, guildId, null, null);
        const sandbox = sinon.createSandbox();
        const endSessionStub = sandbox.stub(gameSession, "endSession");
        after(() => {
            sandbox.restore();
        });

        state.gameSessions = {
            [guildId]: gameSession,
        };

        describe("no inactive gamesessions", () => {
            it("should not clean up", async () => {
                await cleanupInactiveGameSessions();
                assert.strictEqual(state.gameSessions[guildId], gameSession);
                sinon.assert.notCalled(endSessionStub);
            });
        });
        describe("has inactive gamesessions", () => {
            it("should clean up", async () => {
                gameSession.lastActive = Date.now() - (1000 * 60 * 60);
                await cleanupInactiveGameSessions();
                sinon.assert.called(endSessionStub);
            });
        });
    });
});

after(async () => {
    await dbContext.destroy();
});

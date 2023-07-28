import { Sampler } from "../src/Sampler";
import { StatsStorage } from "../src/entries/StatsStorage";
import * as W3CStats from '../src/schema/W3cStatsIdentifiers';
import { createStatsMap } from "../src/utils/Stats";
import { 
    createCodecStats, 
} from "./helpers/StatsGenerator";

const PEER_CONNECTION_ID = "peerConnectionId";
const PEER_CONNECTION_LABEL = "collectorLabel";

describe("Sampler", () => {
    const storage = new StatsStorage();
    const sampler = new Sampler(storage);
    const addStatsToStorage = (...stats: W3CStats.StatsValue[]) => {
        const collectedStats = [{
            peerConnectionId: PEER_CONNECTION_ID,
            statsMap: createStatsMap(stats),
        }];
        storage.update(collectedStats);
    };
    beforeEach(() => {
        storage.addPeerConnection(PEER_CONNECTION_ID, PEER_CONNECTION_LABEL);
    });

    afterEach(() => {
        storage.clear();
    });
    const trimObj = (obj: any) => {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined)
                result[key] = value;
        }
        return result;
    }
    describe("Smoke Tests", () => {
        it('When codec is provided Then codec is added', async () => {
            const statsValue = createCodecStats();
            addStatsToStorage(statsValue);
            const clientSample = sampler.createClientSample();
            expect(trimObj(statsValue)).toMatchObject(trimObj(clientSample.codecs![0]));
        });
    });
});

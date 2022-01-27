import fetch from "node-fetch";
import { parse } from 'node-html-parser';

export class W3CStandardStatsIdentifierFetcher {
    async fetch() {
        
        const response = await fetch('https://www.w3.org/TR/webrtc-stats/');
        const body = await response.text();
        const root = parse(body);
        const tbody = root.querySelector("#summary > table > tbody");
        const rows = tbody.querySelectorAll("tr > td")
        console.log(rows);
    }
}
